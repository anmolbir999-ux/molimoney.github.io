package com.molimoney.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.dp
import com.molimoney.app.data.Store
import com.molimoney.app.data.Tx
import com.molimoney.app.logic.money
import com.molimoney.app.ui.components.Bloom
import com.molimoney.app.ui.components.press
import com.molimoney.app.ui.screens.ActivityScreen
import com.molimoney.app.ui.screens.AddSheet
import com.molimoney.app.ui.screens.GuideScreen
import com.molimoney.app.ui.screens.HomeScreen
import com.molimoney.app.ui.screens.SettingsScreen
import com.molimoney.app.ui.screens.WelcomeScreen
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type

enum class Tab(val label: String) { Home("Home"), Activity("Activity"), Guide("Guide") }

@Composable
fun App(store: Store) {
    val c = Moli.c
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var showSettings by rememberSaveable { mutableStateOf(false) }
    var sheetOpen by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Tx?>(null) }
    val fmt: (Double) -> String = { money(it, store.settings.currency) }

    androidx.compose.runtime.CompositionLocalProvider(com.molimoney.app.ui.screens.LocalCurrency provides store.settings.currency) {
    Box(Modifier.fillMaxSize().background(c.bg)) {
        AnimatedContent(
            targetState = when { !store.settings.onboarded -> 0; showSettings -> 2; else -> 1 },
            transitionSpec = {
                if (targetState > initialState)
                    (fadeIn(tween(380)) + slideInHorizontally(tween(420)) { it / 6 }) togetherWith fadeOut(tween(200))
                else (fadeIn(tween(380)) togetherWith (fadeOut(tween(220)) + slideOutHorizontally(tween(300)) { it / 6 }))
            },
            label = "root",
        ) { state ->
            when (state) {
                0 -> WelcomeScreen(store)
                2 -> {
                    BackHandler { showSettings = false }
                    SettingsScreen(store, onBack = { showSettings = false })
                }
                else -> Column(Modifier.fillMaxSize()) {
                    BackHandler(enabled = tab != Tab.Home) { tab = Tab.Home }
                    Box(Modifier.weight(1f)) {
                        AnimatedContent(
                            targetState = tab,
                            transitionSpec = {
                                (fadeIn(tween(360, delayMillis = 60)) + slideInVertically(tween(420)) { it / 30 }) togetherWith fadeOut(tween(140))
                            },
                            label = "tab",
                        ) { t ->
                            when (t) {
                                Tab.Home -> HomeScreen(store, fmt, onSettings = { showSettings = true }, onGuide = { tab = Tab.Guide },
                                    onOpen = { editing = it; sheetOpen = true }, onSeeAll = { tab = Tab.Activity })
                                Tab.Activity -> ActivityScreen(store, fmt, onOpen = { editing = it; sheetOpen = true })
                                Tab.Guide -> GuideScreen(store, fmt)
                            }
                        }
                        Fab(visible = tab != Tab.Guide, modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp)) {
                            editing = null; sheetOpen = true
                        }
                    }
                    NavBar(tab) { tab = it }
                }
            }
        }
        if (sheetOpen) AddSheet(store, editing, onDismiss = { sheetOpen = false; editing = null })
    }
    }
}

@Composable
private fun Fab(visible: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = Moli.c
    AnimatedVisibility(visible, modifier, enter = scaleIn(tween(300)) + fadeIn(), exit = scaleOut(tween(200)) + fadeOut()) {
        Box(
            Modifier.size(58.dp).shadow(10.dp, CircleShape, ambientColor = c.clay, spotColor = c.clay)
                .clip(CircleShape).background(c.clay).press(onClick),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Add, "Add", tint = c.onClay, modifier = Modifier.size(26.dp)) }
    }
}

@Composable
private fun NavBar(tab: Tab, onTab: (Tab) -> Unit) {
    val c = Moli.c
    Column(Modifier.fillMaxWidth().background(c.bg)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 18.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceAround,
        ) {
            Tab.entries.forEach { t ->
                val sel = t == tab
                val bg by animateColorAsState(if (sel) c.clay.copy(alpha = 0.13f) else c.bg, tween(300), label = "nav")
                val fg by animateColorAsState(if (sel) c.clay else c.muted, tween(300), label = "navfg")
                Row(
                    Modifier.clip(RoundedCornerShape(50)).background(bg).press { onTab(t) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    when (t) {
                        Tab.Home -> Icon(Icons.Filled.Home, null, tint = fg, modifier = Modifier.size(20.dp))
                        Tab.Activity -> Icon(Icons.Filled.List, null, tint = fg, modifier = Modifier.size(20.dp))
                        Tab.Guide -> Bloom(18.dp, color = fg)
                    }
                    AnimatedVisibility(sel) {
                        Row { Spacer(Modifier.size(8.dp)); Text(t.label, style = Type.small, color = fg) }
                    }
                }
            }
        }
    }
}
