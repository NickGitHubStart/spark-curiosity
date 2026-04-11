package com.sparkcuriosity.app.ui

import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.data.repo.MemoryRepository
import com.sparkcuriosity.app.MainActivity
import com.sparkcuriosity.app.ui.screen.ChatScreen
import com.sparkcuriosity.app.ui.screen.FocusScreen
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

    val token by tokenRepo.tokenFlow.collectAsState(initial = null)

    val api = remember {
        SparkApi(tokenProvider = { token })
    }
    val memoryRepo = remember {
        MemoryRepository(api, app.memoryCrypto)
    }

    // Determine start destination based on token presence
    val startDestination = if (token != null) "home" else "setup"

    // Navigate to curated screen when a block intent arrives
    val activity = context as? MainActivity
    val blockedSite = activity?.blockedSite?.value
    LaunchedEffect(blockedSite) {
        if (blockedSite != null) {
            navController.navigate("curated")
        }
    }

    NavHost(navController = navController, startDestination = startDestination) {
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
                    navController.navigate("home") {
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
            FocusScreen(
                onBack = {
                    activity?.blockedSite?.value = null
                    activity?.blockedReason?.value = null
                    navController.popBackStack()
                }
            )
        }
    }
}
