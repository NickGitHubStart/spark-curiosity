package com.sparkcuriosity.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.repo.MemoryRepository
import com.sparkcuriosity.app.MainActivity
import com.sparkcuriosity.app.ui.screen.ChatScreen
import com.sparkcuriosity.app.ui.screen.PondonScreen
import com.sparkcuriosity.app.ui.screen.HomeScreen
import com.sparkcuriosity.app.ui.screen.OnboardingScreen
import com.sparkcuriosity.app.ui.screen.PairScreen
import com.sparkcuriosity.app.ui.screen.SetupScreen
import com.sparkcuriosity.app.ui.screen.StatsScreen

@Composable
fun SparkNavHost() {
    val navController = rememberNavController()
    val context = LocalContext.current
    val app = context.applicationContext as SparkApp
    val tokenRepo = app.tokenRepository

    // Always resolve token from DataStore inside requests — avoids null auth on cold start
    // before tokenFlow has emitted (bootstrap loads memory with a valid token).
    val api = remember {
        SparkApi(tokenProvider = { tokenRepo.getToken() })
    }
    val memoryRepo = remember {
        MemoryRepository(api, app.memoryCrypto)
    }

    // Navigate to Pondon when a block intent arrives (seq ensures repeat opens for same site)
    val activity = context as? MainActivity
    val blockedSite = activity?.blockedSite?.value
    val blockEventSeq = activity?.blockEventSeq?.value
    LaunchedEffect(blockedSite, blockEventSeq) {
        if (blockedSite != null && (blockEventSeq ?: 0L) > 0L) {
            runCatching { navController.navigate("curated") { launchSingleTop = true } }
        }
    }

    NavHost(navController = navController, startDestination = "bootstrap") {
        composable("bootstrap") {
            LaunchedEffect(Unit) {
                val t = tokenRepo.getToken()
                if (t == null) {
                    navController.navigate("setup") {
                        popUpTo("bootstrap") { inclusive = true }
                    }
                } else {
                    val snap = memoryRepo.loadPlaintext()
                    if (!snap.onboardingComplete) {
                        navController.navigate("onboarding") {
                            popUpTo("bootstrap") { inclusive = true }
                        }
                    } else {
                        navController.navigate("home") {
                            popUpTo("bootstrap") { inclusive = true }
                        }
                    }
                }
            }
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        composable("setup") {
            SetupScreen(
                api = api,
                tokenRepo = tokenRepo,
                onSetupComplete = {
                    navController.navigate("onboarding") {
                        popUpTo("setup") { inclusive = true }
                    }
                },
                onPairComplete = {
                    navController.navigate("bootstrap") {
                        popUpTo("setup") { inclusive = true }
                    }
                }
            )
        }
        composable("pair") {
            PairScreen(onBack = { navController.popBackStack() })
        }
        composable("onboarding") {
            OnboardingScreen(
                api = api,
                memoryRepo = memoryRepo,
                onComplete = {
                    navController.navigate("home") {
                        popUpTo("onboarding") { inclusive = true }
                    }
                }
            )
        }
        composable("home") {
            HomeScreen(
                api = api,
                onOpenChat = { navController.navigate("chat") },
                onOpenStats = { navController.navigate("stats") },
                onOpenPair = { navController.navigate("pair") }
            )
        }
        composable("chat") {
            ChatScreen(
                api = api,
                memoryRepo = memoryRepo,
                onBack = { navController.popBackStack() }
            )
        }
        composable("stats") {
            StatsScreen(
                api = api,
                onBack = { navController.popBackStack() }
            )
        }
        composable("curated") {
            val seq = activity?.blockEventSeq?.value
            key(seq) {
                PondonScreen(
                    blockedSiteLabel = activity?.blockedSite?.value
                ) {
                    activity?.blockedSite?.value = null
                    activity?.blockedReason?.value = null
                    navController.popBackStack()
                }
            }
        }
    }
}
