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
import com.molimoney.app.ui.screens.WrappedScreen
import com.molimoney.app.ui.screens.SettingsScreen
import com.molimoney.app.ui.screens.ImportSheet
import com.molimoney.app.ui.screens.ImportState
import com.molimoney.app.ui.components.Buddy
import com.molimoney.app.logic.Mood
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
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
    @Test fun activity() { val s = store(true); shot("activity") { ActivityScreen(s, { money(it, "$") }, onOpen = {}) } }
    @Test fun welcome() { val s = store(false, onboarded = false); shot("welcome") { App(s) } }
    @Test fun empty() { val s = store(false); shot("empty") { App(s) } }
    @Test fun wrappedFirst() { val s = store(true); rule.mainClock.autoAdvance = false
        rule.setContent { MoliTheme { WrappedScreen(s, { money(it, "$") }) {} } }
        rule.mainClock.advanceTimeBy(3000); rule.onRoot().captureRoboImage("screenshots/wrapped1.png")
        rule.mainClock.advanceTimeBy(5200 * 2); rule.onRoot().captureRoboImage("screenshots/wrapped3.png")
        rule.mainClock.advanceTimeBy(5200 * 4); rule.onRoot().captureRoboImage("screenshots/wrapped_end.png") }
    @Test fun settings() { val s = store(true); shot("settings") { SettingsScreen(s, {}) } }
    @Test fun buddies() { shot("buddies") {
        androidx.compose.foundation.layout.Row(Modifier.padding(16.dp)) {
            Mood.entries.forEach { Buddy(90.dp, it) }
        } } }
    @Test fun importSheet() { val s = store(false)
        val csv = "Date,Description,Amount\n2026-11-02,STARBUCKS,-5.75\n2026-11-03,UBER *TRIP,-18.20\n2026-11-15,PAYROLL,3200\n"
        val res = com.molimoney.app.logic.StatementImport.parse(csv, emptyList())
        rule.mainClock.autoAdvance = false
        rule.setContent { MoliTheme { ImportSheet(s, ImportState.Ready(res), {}, {}) } }
        rule.mainClock.advanceTimeBy(4000)
        com.github.takahirom.roborazzi.captureScreenRoboImage("screenshots/import.png") }
}
