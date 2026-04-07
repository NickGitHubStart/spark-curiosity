package com.sparkcuriosity.app.ui

import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.sparkcuriosity.app.SparkApp
import com.sparkcuriosity.app.data.api.SparkApi
import com.sparkcuriosity.app.ui.screen.ChatScreen
import com.sparkcuriosity.app.ui.screen.HomeScreen
import com.sparkcuriosity.app.ui.screen.OnboardingScreen
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

    // Determine start destination based on token presence
    val startDestination = if (token != null) "home" else "setup"

    NavHost(navController = navController, startDestination = startDestination) {
        composable("setup") {
            SetupScreen(
                api = api,
                tokenRepo = tokenRepo,
                onSetupComplete = {
                    navController.navigate("onboarding") {
                        popUpTo("setup") { inclusive = true }
                    }
                }
            )
        }
        composable("onboarding") {
            OnboardingScreen(
                api = api,
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
                onOpenStats = { navController.navigate("stats") }
            )
        }
        composable("chat") {
            ChatScreen(
                api = api,
                onBack = { navController.popBackStack() }
            )
        }
        composable("stats") {
            StatsScreen(
                api = api,
                onBack = { navController.popBackStack() }
            )
        }
    }
}
