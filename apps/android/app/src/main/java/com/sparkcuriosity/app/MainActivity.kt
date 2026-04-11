package com.sparkcuriosity.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf
import com.sparkcuriosity.app.service.SparkVpnService
import com.sparkcuriosity.app.ui.SparkNavHost
import com.sparkcuriosity.app.ui.theme.SparkTheme

class MainActivity : ComponentActivity() {

    /** Set by intent extras when AccessibilityService opens this activity on a block. */
    val blockedSite = mutableStateOf<String?>(null)
    val blockedReason = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleBlockIntent(intent)
        enableEdgeToEdge()
        setContent {
            SparkTheme {
                SparkNavHost()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleBlockIntent(intent)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST_CODE && resultCode == Activity.RESULT_OK) {
            startService(Intent(this, SparkVpnService::class.java))
        }
    }

    private fun handleBlockIntent(intent: Intent?) {
        val site = intent?.getStringExtra("blocked_site")
        if (site != null) {
            blockedSite.value = site
            blockedReason.value = intent.getStringExtra("blocked_reason")
        }
    }

    companion object {
        const val VPN_REQUEST_CODE = 1001
    }
}
