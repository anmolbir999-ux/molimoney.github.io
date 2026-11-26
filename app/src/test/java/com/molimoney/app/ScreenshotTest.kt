package com.molimoney.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import com.molimoney.app.data.Store
import com.molimoney.app.logic.money
import com.molimoney.app.ui.App
import com.molimoney.app.ui.screens.ActivityScreen
import com.molimoney.app.ui.screens.GuideScreen
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.MoliTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Renders the main screens with sample data to PNGs for visual review. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w400dp-h900dp-xxhdpi")
class ScreenshotTest {
    @get:Rule val rule = createComposeRule()

    private fun store(sample: Boolean, onboarded: Boolean = true) = Store(ApplicationProvider.getApplicationContext()).apply {
        updateSettings { it.copy(name = "Alex", currency = "$", onboarded = onboarded) }
        if (sample) loadSample() else eraseAll()
    }

    private fun shot(name: String, content: @Composable () -> Unit) {
        rule.mainClock.autoAdvance = false
        rule.setContent { MoliTheme { Box(Modifier.fillMaxSize().background(Moli.c.bg)) { content() } } }
        rule.mainClock.advanceTimeBy(6000)
        rule.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun home() { val s = store(true); shot("home") { App(s) } }
    @Test fun guide() { val s = store(true); shot("guide") { GuideScreen(s) { money(it, "$") } } }
    @Test fun activity() { val s = store(true); shot("activity") { ActivityScreen(s, { money(it, "$") }) {} } }
    @Test fun welcome() { val s = store(false, onboarded = false); shot("welcome") { App(s) } }
    @Test fun empty() { val s = store(false); shot("empty") { App(s) } }
}
