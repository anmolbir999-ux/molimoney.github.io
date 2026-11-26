package com.molimoney.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.molimoney.app.system.DailyAlarm
import com.molimoney.app.system.Notifier
import com.molimoney.app.system.SpendListener
import com.molimoney.app.ui.components.PrimaryButton
import com.molimoney.app.ui.openAppInfo
import com.molimoney.app.ui.openListenerSettings
import com.molimoney.app.ui.rememberEnableWrapped
import com.molimoney.app.data.Store
import com.molimoney.app.ui.components.Bloom
import com.molimoney.app.ui.components.Chip
import com.molimoney.app.ui.components.Eyebrow
import com.molimoney.app.ui.components.GhostButton
import com.molimoney.app.ui.components.MCard
import com.molimoney.app.ui.components.Reveal
import com.molimoney.app.ui.components.press
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(store: Store, onBack: () -> Unit, onImport: () -> Unit = {}, onWrapped: () -> Unit = {}) {
    val ctx = LocalContext.current
    var listening by remember { mutableStateOf(SpendListener.hasAccess(ctx)) }
    var canPost by remember { mutableStateOf(Notifier.canPost(ctx)) }
    LifecycleResumeEffect(Unit) { listening = SpendListener.hasAccess(ctx); canPost = Notifier.canPost(ctx); onPauseOrDispose { } }
    val enableWrapped = rememberEnableWrapped(store)
    val c = Moli.c
    val s = store.settings
    var name by remember { mutableStateOf(s.name) }
    var goal by remember { mutableFloatStateOf(s.goalPct.toFloat()) }
    var confirm by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()
            .verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).clip(CircleShape).press(onBack), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.ArrowBack, "Back", tint = c.ink)
            }
            Text("Settings", style = Type.title, color = c.ink, modifier = Modifier.padding(start = 6.dp))
        }
        Reveal(0) {
            MCard {
                Eyebrow("Name")
                Spacer(Modifier.height(10.dp))
                Field(name, { name = it; store.updateSettings { st -> st.copy(name = it.trim()) } }, "Your name")
            }
        }
        Reveal(1) {
            MCard {
                Eyebrow("Currency")
                Spacer(Modifier.height(10.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Currencies.forEach { cur -> Chip(cur, cur == s.currency) { store.updateSettings { it.copy(currency = cur) } } }
                }
            }
        }
        Reveal(2) {
            MCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Eyebrow("Savings goal", Modifier.weight(1f))
                    Text("${goal.toInt()}% of income", style = Type.body, color = c.clay)
                }
                Slider(
                    goal, { goal = it }, valueRange = 5f..50f, steps = 8,
                    onValueChangeFinished = { store.updateSettings { it.copy(goalPct = goal.toInt()) } },
                    colors = SliderDefaults.colors(thumbColor = c.clay, activeTrackColor = c.clay, inactiveTrackColor = c.line,
                        activeTickColor = c.clay, inactiveTickColor = c.faint),
                )
                Text("20% is a solid default. The guide measures you against this.", style = Type.small, color = c.muted)
            }
        }
        Reveal(3) {
            MCard {
                ToggleRow("Daily wrap-up", "A recap of your day every evening, with a tip for tomorrow.", s.wrapped && canPost) { on ->
                    if (on) enableWrapped() else { store.updateSettings { it.copy(wrapped = false) }; DailyAlarm.sync(ctx) }
                }
                if (s.wrapped && canPost) {
                    Spacer(Modifier.height(12.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(19, 20, 21, 22, 23).forEach { h ->
                            Chip("${h - 12} PM", s.wrappedHour == h) { store.updateSettings { it.copy(wrappedHour = h) }; DailyAlarm.sync(ctx) }
                        }
                    }
                }
                if (s.wrapped && !canPost) Text("Notifications are blocked for Moli. Allow them in App info.", style = Type.small, color = c.clay,
                    modifier = Modifier.padding(top = 8.dp).press { openAppInfo(ctx) })
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GhostButton("Watch today's", Modifier.weight(1f), onClick = onWrapped)
                    GhostButton("Send test", Modifier.weight(1f)) { if (canPost) Notifier.wrapped(ctx) else enableWrapped() }
                }
            }
        }
        Reveal(4) {
            MCard {
                ToggleRow("Auto-log payments", "Reads payment alerts from bank, card and UPI apps and logs them for you. Chats and email are ignored.",
                    s.autoTrack && listening) { on ->
                    store.updateSettings { it.copy(autoTrack = on) }
                    if (on && !listening) openListenerSettings(ctx)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    when {
                        listening && s.autoTrack -> "On. Moli is listening for payments."
                        listening -> "Access granted, but logging is paused."
                        else -> "Needs notification access. Tap the switch to open the setting."
                    },
                    style = Type.small, color = if (listening && s.autoTrack) c.sage else c.muted,
                )
                if (!listening) Text("Android 13+ may say “Restricted setting” for apps installed from a file. Fix: App info → ⋮ → Allow restricted settings.",
                    style = Type.small, color = c.clay, modifier = Modifier.padding(top = 6.dp).press { openAppInfo(ctx) })
            }
        }
        Reveal(5) {
            MCard {
                Eyebrow("Data")
                Spacer(Modifier.height(10.dp))
                PrimaryButton("Import bank statement", Modifier.fillMaxWidth(), onClick = onImport)
                Spacer(Modifier.height(6.dp))
                Text("CSV or OFX/QFX, as exported from your bank's app or website.", style = Type.small, color = c.muted)
                Spacer(Modifier.height(12.dp))
                GhostButton("Load sample data", Modifier.fillMaxWidth()) { confirm = "sample" }
                Spacer(Modifier.height(8.dp))
                GhostButton("Erase all transactions", Modifier.fillMaxWidth(), color = c.clay) { confirm = "erase" }
                Spacer(Modifier.height(10.dp))
                Text("Everything is stored only on this phone. Nothing is uploaded.", style = Type.small, color = c.muted)
            }
        }
        Reveal(6) {
            Column(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Bloom(28.dp)
                Spacer(Modifier.height(8.dp))
                Text("Moli 1.1", style = Type.small, color = c.faint)
            }
        }
    }

    confirm?.let { what ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            containerColor = c.card,
            title = { Text(if (what == "erase") "Erase everything?" else "Replace with sample data?", style = Type.heading, color = c.ink) },
            text = { Text(if (what == "erase") "All your transactions will be deleted. This can't be undone."
                else "Your current transactions will be replaced with a few months of example data.", style = Type.body, color = c.muted) },
            confirmButton = {
                TextButton({ if (what == "erase") store.eraseAll() else store.loadSample(); Streamed.seen.clear(); confirm = null }) {
                    Text(if (what == "erase") "Erase" else "Replace", color = c.clay)
                }
            },
            dismissButton = { TextButton({ confirm = null }) { Text("Cancel", color = c.muted) } },
        )
    }
}

private val Streamed = com.molimoney.app.ui.components.Streamed

@Composable
private fun ToggleRow(title: String, sub: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val c = Moli.c
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = Type.heading, color = c.ink)
            Spacer(Modifier.height(2.dp))
            Text(sub, style = Type.small, color = c.muted)
        }
        Spacer(Modifier.size(12.dp))
        Switch(checked, onChange, colors = SwitchDefaults.colors(
            checkedThumbColor = c.onClay, checkedTrackColor = c.clay, uncheckedThumbColor = c.faint,
            uncheckedTrackColor = c.line, uncheckedBorderColor = c.line,
        ))
    }
}
