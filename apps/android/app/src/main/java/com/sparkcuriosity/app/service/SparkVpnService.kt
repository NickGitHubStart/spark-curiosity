package com.sparkcuriosity.app.service

import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.api.SparkApi
import kotlinx.coroutines.*
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.nio.ByteBuffer

/**
 * Local VPN that intercepts DNS queries and blocks configured domains.
 *
 * How it works:
 * 1. Creates a TUN interface that captures all device traffic
 * 2. Only inspects DNS packets (UDP port 53)
 * 3. For blocked domains: returns 0.0.0.0 (NXDOMAIN-like)
 * 4. For allowed domains: forwards to real DNS server and returns the response
 * 5. All non-DNS traffic is forwarded transparently
 *
 * The blocked-domains list is synced from the cloud curated-gate API periodically.
 */
class SparkVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var running = false

    // Blocked host suffixes (synced from curated gate)
    // Each entry is a bare domain like "youtube.com" — matches that domain and all subdomains
    @Volatile
    var blockedHosts: Set<String> = emptySet()
        private set

    // Upstream DNS server
    private val dnsServer = "1.1.1.1"
    private val dnsPort = 53

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!running) {
            startVpn()
            syncBlockedHosts()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        scope.cancel()
        vpnInterface?.close()
        vpnInterface = null
        instance = null
        super.onDestroy()
    }

    private fun startVpn() {
        val builder = Builder()
            .setSession("Spark Curiosity")
            .addAddress("10.0.0.2", 32)
            .addDnsServer("10.0.0.1") // Fake DNS — all queries come to our TUN
            .addRoute("10.0.0.1", 32) // Only route our fake DNS IP through the VPN
            // Exclude our own app so API calls don't loop
            .addDisallowedApplication(packageName)

        vpnInterface = builder.establish() ?: return
        running = true

        scope.launch { tunnelLoop() }
    }

    /**
     * Main tunnel loop: reads IP packets from TUN, inspects DNS, blocks or forwards.
     */
    private suspend fun tunnelLoop() {
        val vpnFd = vpnInterface ?: return
        val input = FileInputStream(vpnFd.fileDescriptor)
        val output = FileOutputStream(vpnFd.fileDescriptor)
        val packet = ByteBuffer.allocate(32767)

        while (running) {
            try {
                packet.clear()
                val length = input.read(packet.array())
                if (length <= 0) {
                    delay(10)
                    continue
                }
                packet.limit(length)

                // Parse IP header to check if this is a UDP DNS packet
                if (length < 20) continue
                val version = (packet[0].toInt() shr 4) and 0xF
                if (version != 4) {
                    // IPv6 or other — pass through by writing back (will be dropped since no IPv6 route)
                    continue
                }

                val headerLength = (packet[0].toInt() and 0xF) * 4
                val protocol = packet[9].toInt() and 0xFF // 17 = UDP

                if (protocol != 17 || length < headerLength + 8) {
                    // Non-UDP traffic — forward through the real network
                    forwardNonDnsPacket(packet.array(), length, output)
                    continue
                }

                // UDP header starts at headerLength
                val destPort = ((packet[headerLength + 2].toInt() and 0xFF) shl 8) or
                        (packet[headerLength + 3].toInt() and 0xFF)

                if (destPort != dnsPort) {
                    forwardNonDnsPacket(packet.array(), length, output)
                    continue
                }

                // This is a DNS query — extract and handle
                val udpDataOffset = headerLength + 8
                val dnsData = packet.array().copyOfRange(udpDataOffset, length)

                val queryName = extractDnsQueryName(dnsData)
                if (queryName != null && isBlocked(queryName)) {
                    // Build a fake DNS response that returns 0.0.0.0
                    val fakeResponse = buildBlockedDnsResponse(dnsData)
                    if (fakeResponse != null) {
                        val responsePacket = buildDnsResponsePacket(
                            packet.array(), headerLength, fakeResponse
                        )
                        output.write(responsePacket)
                        output.flush()

                        // Notify the accessibility service about the block
                        notifyBlock(queryName)
                    }
                } else {
                    // Forward DNS to real server and write response back
                    val realResponse = forwardDnsQuery(dnsData) ?: continue
                    val responsePacket = buildDnsResponsePacket(
                        packet.array(), headerLength, realResponse
                    )
                    output.write(responsePacket)
                    output.flush()
                }
            } catch (e: Exception) {
                if (!running) break
                delay(50)
            }
        }
    }

    /**
     * Non-DNS packets need to be forwarded through a protect()'d socket.
     * For simplicity, we only handle DNS; other traffic is simply dropped.
     * This works because we route only DNS through the VPN in practice —
     * apps still connect normally since we addRoute("0.0.0.0", 0) only
     * to capture DNS. Actually, since all traffic is routed through TUN,
     * we need to forward non-DNS packets too.
     *
     * Simplified approach: only capture DNS by using addRoute for the DNS server only.
     */
    private fun forwardNonDnsPacket(data: ByteArray, length: Int, output: FileOutputStream) {
        // In our simplified VPN, non-DNS packets are dropped.
        // The VPN only intercepts DNS — all other traffic bypasses because
        // we'll use a DNS-only route instead of 0.0.0.0/0.
    }

    /**
     * Forwards a DNS query to the real upstream DNS server.
     */
    private fun forwardDnsQuery(dnsData: ByteArray): ByteArray? {
        return try {
            val socket = DatagramSocket()
            protect(socket) // Prevent the socket from going through our own VPN
            socket.soTimeout = 5000

            val address = InetAddress.getByName(dnsServer)
            val sendPacket = DatagramPacket(dnsData, dnsData.size, address, dnsPort)
            socket.send(sendPacket)

            val responseBuffer = ByteArray(1024)
            val receivePacket = DatagramPacket(responseBuffer, responseBuffer.size)
            socket.receive(receivePacket)
            socket.close()

            responseBuffer.copyOf(receivePacket.length)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Extract the domain name from a DNS query packet.
     */
    private fun extractDnsQueryName(dnsData: ByteArray): String? {
        if (dnsData.size < 12) return null
        // DNS header is 12 bytes, question section starts at offset 12
        var offset = 12
        val parts = mutableListOf<String>()
        while (offset < dnsData.size) {
            val labelLen = dnsData[offset].toInt() and 0xFF
            if (labelLen == 0) break
            if (offset + 1 + labelLen > dnsData.size) return null
            parts.add(String(dnsData, offset + 1, labelLen))
            offset += 1 + labelLen
        }
        return if (parts.isNotEmpty()) parts.joinToString(".").lowercase() else null
    }

    /**
     * Check if a hostname matches any blocked host.
     */
    private fun isBlocked(hostname: String): Boolean {
        val lower = hostname.lowercase()
        for (blocked in blockedHosts) {
            if (lower == blocked || lower.endsWith(".$blocked")) return true
        }
        return false
    }

    /**
     * Build a DNS response that returns 0.0.0.0 for a blocked domain.
     * Copies the query and sets response flags + an A record answer pointing to 0.0.0.0.
     */
    private fun buildBlockedDnsResponse(queryData: ByteArray): ByteArray? {
        if (queryData.size < 12) return null

        val response = queryData.copyOf(queryData.size + 16) // room for answer
        // Set QR bit (response), RCODE=0 (no error)
        response[2] = (response[2].toInt() or 0x80).toByte() // QR = 1
        response[3] = (response[3].toInt() and 0xF0).toByte() // RCODE = 0
        // Set answer count = 1
        response[6] = 0
        response[7] = 1

        // Find end of question section
        var offset = 12
        while (offset < queryData.size && queryData[offset].toInt() != 0) {
            val len = queryData[offset].toInt() and 0xFF
            offset += 1 + len
        }
        offset += 1 // skip null terminator
        offset += 4 // skip QTYPE + QCLASS

        // Append answer: pointer to name (0xC00C), type A, class IN, TTL=60, RDLENGTH=4, 0.0.0.0
        val answerOffset = offset
        response[answerOffset] = 0xC0.toByte() // Pointer to offset 12 (start of name)
        response[answerOffset + 1] = 0x0C.toByte()
        response[answerOffset + 2] = 0x00.toByte() // Type A
        response[answerOffset + 3] = 0x01.toByte()
        response[answerOffset + 4] = 0x00.toByte() // Class IN
        response[answerOffset + 5] = 0x01.toByte()
        response[answerOffset + 6] = 0x00.toByte() // TTL = 60
        response[answerOffset + 7] = 0x00.toByte()
        response[answerOffset + 8] = 0x00.toByte()
        response[answerOffset + 9] = 0x3C.toByte()
        response[answerOffset + 10] = 0x00.toByte() // RDLENGTH = 4
        response[answerOffset + 11] = 0x04.toByte()
        response[answerOffset + 12] = 0x00.toByte() // 0.0.0.0
        response[answerOffset + 13] = 0x00.toByte()
        response[answerOffset + 14] = 0x00.toByte()
        response[answerOffset + 15] = 0x00.toByte()

        return response.copyOf(answerOffset + 16)
    }

    /**
     * Wraps a DNS response payload back into an IP+UDP packet for the TUN interface.
     * Swaps src/dest IP and ports from the original request packet.
     */
    private fun buildDnsResponsePacket(
        originalIpPacket: ByteArray,
        ipHeaderLength: Int,
        dnsResponse: ByteArray
    ): ByteArray {
        val udpLength = 8 + dnsResponse.size
        val totalLength = ipHeaderLength + udpLength
        val result = ByteArray(totalLength)

        // Copy IP header
        System.arraycopy(originalIpPacket, 0, result, 0, ipHeaderLength)

        // Swap source and destination IP addresses
        System.arraycopy(originalIpPacket, 16, result, 12, 4) // dest → src
        System.arraycopy(originalIpPacket, 12, result, 16, 4) // src → dest

        // Update total length
        result[2] = ((totalLength shr 8) and 0xFF).toByte()
        result[3] = (totalLength and 0xFF).toByte()

        // Zero checksum (recalculate would be better but most stacks accept 0)
        result[10] = 0
        result[11] = 0

        // UDP header: swap ports
        result[ipHeaderLength] = originalIpPacket[ipHeaderLength + 2] // dest port → src port
        result[ipHeaderLength + 1] = originalIpPacket[ipHeaderLength + 3]
        result[ipHeaderLength + 2] = originalIpPacket[ipHeaderLength] // src port → dest port
        result[ipHeaderLength + 3] = originalIpPacket[ipHeaderLength + 1]
        // UDP length
        result[ipHeaderLength + 4] = ((udpLength shr 8) and 0xFF).toByte()
        result[ipHeaderLength + 5] = (udpLength and 0xFF).toByte()
        // UDP checksum = 0 (optional for IPv4)
        result[ipHeaderLength + 6] = 0
        result[ipHeaderLength + 7] = 0

        // DNS payload
        System.arraycopy(dnsResponse, 0, result, ipHeaderLength + 8, dnsResponse.size)

        // Recalculate IP header checksum
        recalcIpChecksum(result, ipHeaderLength)

        return result
    }

    private fun recalcIpChecksum(packet: ByteArray, headerLength: Int) {
        packet[10] = 0
        packet[11] = 0
        var sum = 0L
        for (i in 0 until headerLength step 2) {
            sum += ((packet[i].toInt() and 0xFF) shl 8) or (packet[i + 1].toInt() and 0xFF)
        }
        while (sum shr 16 != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
        val checksum = sum.inv().toInt() and 0xFFFF
        packet[10] = ((checksum shr 8) and 0xFF).toByte()
        packet[11] = (checksum and 0xFF).toByte()
    }

    /**
     * Notify the system about a DNS-level block so CuratedScreen can be shown.
     */
    private fun notifyBlock(hostname: String) {
        scope.launch(Dispatchers.Main) {
            OverlayService.handleCommand(
                com.sparkcuriosity.app.data.model.Command(
                    type = "redirect",
                    url = "spark://curated?site=${java.net.URLEncoder.encode(hostname, "UTF-8")}",
                    closeTab = true,
                    reason = "dns_block"
                )
            )
        }
    }

    /**
     * Periodically sync blocked hosts from the curated-gate cloud API.
     */
    private fun syncBlockedHosts() {
        scope.launch {
            while (running) {
                try {
                    val app = application as SparkApp
                    val api = SparkApi(tokenProvider = {
                        runBlocking { app.tokenRepository.getToken() }
                    })
                    val response = api.getCuratedGate()
                    if (response.enabled) {
                        val hosts = mutableSetOf<String>()
                        for (rule in response.rules) {
                            rule.host?.let { hosts.add(it.lowercase()) }
                            rule.hostSuffix?.let { hosts.add(it.lowercase().removePrefix(".")) }
                        }
                        blockedHosts = hosts
                    } else {
                        blockedHosts = emptySet()
                    }
                } catch (_: Exception) {}
                delay(SYNC_INTERVAL_MS)
            }
        }
    }

    companion object {
        const val ACTION_STOP = "com.sparkcuriosity.app.STOP_VPN"
        private const val SYNC_INTERVAL_MS = 5 * 60 * 1000L // 5 minutes
        private var instance: SparkVpnService? = null

        fun isRunning(): Boolean = instance?.running == true
        fun getBlockedHosts(): Set<String> = instance?.blockedHosts ?: emptySet()
    }
}
