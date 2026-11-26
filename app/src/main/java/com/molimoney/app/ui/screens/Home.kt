package com.molimoney.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.molimoney.app.logic.Mood
import com.molimoney.app.logic.Report
import com.molimoney.app.logic.Tone
import com.molimoney.app.system.SpendListener
import com.molimoney.app.ui.components.BubbleShape
import com.molimoney.app.ui.components.Buddy
import com.molimoney.app.ui.components.GhostButton
import com.molimoney.app.ui.components.PrimaryButton
import com.molimoney.app.ui.openAppInfo
import com.molimoney.app.ui.openListenerSettings
import com.molimoney.app.data.Store
import com.molimoney.app.data.Tx
import com.molimoney.app.data.earned
import com.molimoney.app.data.inMonth
import com.molimoney.app.data.spent
import com.molimoney.app.logic.Advisor
import com.molimoney.app.ui.components.Bars
import com.molimoney.app.ui.components.Bloom
import com.molimoney.app.ui.components.Donut
import com.molimoney.app.ui.components.Eyebrow
import com.molimoney.app.ui.components.MCard
import com.molimoney.app.ui.components.Reveal
import com.molimoney.app.ui.components.SpendLine
import com.molimoney.app.ui.components.StreamText
import com.molimoney.app.ui.components.animatedValue
import com.molimoney.app.ui.components.press
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.format.TextStyle as JTextStyle
import java.util.Locale

/** Cumulative daily spend for [m], up to [upTo] days. */
fun cumulative(txs: List<Tx>, m: YearMonth, upTo: Int): List<Float> {
    val byDay = DoubleArray(m.lengthOfMonth() + 1)
    txs.forEach { if (!it.isIncome && it.month == m) byDay[it.date.dayOfMonth] += it.amount }
    var run = 0.0
    return (1..upTo).map { d -> run += byDay[d]; run.toFloat() }
}

@Composable
fun HomeScreen(
    store: Store, fmt: (Double) -> String, onSettings: () -> Unit, onGuide: () -> Unit,
    onOpen: (Tx) -> Unit, onSeeAll: () -> Unit, onWrapped: () -> Unit = {}, onImport: () -> Unit = {},
) {
    val ctx = LocalContext.current
    var listening by remember { mutableStateOf(SpendListener.hasAccess(ctx)) }
    LifecycleResumeEffect(Unit) { listening = SpendListener.hasAccess(ctx); onPauseOrDispose { } }
    val c = Moli.c
    val txs = store.txs.toList()
    val today = LocalDate.now()
    val ym = YearMonth.from(today)
    val month = txs.inMonth(ym)
    val spent = month.spent()
    val earned = month.earned()
    val last = ym.minusMonths(1)
    val lastSpentSameDay = cumulative(txs, last, minOf(today.dayOfMonth, last.lengthOfMonth())).lastOrNull()?.toDouble() ?: 0.0
    val report = remember(txs, store.settings) { Advisor.analyze(txs, store.settings, fmt) }

    Column(
        Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Reveal(0) {
            Row(Modifier.fillMaxWidth().padding(top = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    val h = LocalTime.now().hour
                    val greet = when { h < 5 -> "Up late"; h < 12 -> "Good morning"; h < 17 -> "Good afternoon"; else -> "Good evening" }
                    val name = store.settings.name.takeIf { it.isNotBlank() }?.let { ", $it" } ?: ""
                    Text("$greet$name", style = Type.title, color = c.ink)
                    Text(today.month.getDisplayName(JTextStyle.FULL, Locale.getDefault()) + " at a glance", style = Type.small, color = c.muted)
                }
                Box(Modifier.size(40.dp).clip(CircleShape).press(onSettings), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Settings, "Settings", tint = c.muted, modifier = Modifier.size(22.dp))
                }
            }
        }

        // Today, wrapped
        Reveal(1) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.ink).press(onWrapped).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Bloom(20.dp, color = c.clay)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("Today, wrapped", style = Type.body.copy(fontWeight = FontWeight.Medium), color = c.bg)
                    Text("Your day in a few taps", style = Type.small, color = c.bg.copy(alpha = 0.65f))
                }
                Text("Play ▸", style = Type.small, color = c.clay)
            }
        }

        // Ask to auto-log payments
        val showSetup = !store.settings.hideSetupCard && !(store.settings.autoTrack && listening)
        if (showSetup) Reveal(1) {
            MCard {
                Row(verticalAlignment = Alignment.Top) {
                    Buddy(52.dp, Mood.WAVE)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Want me to log payments for you?", style = Type.heading, color = c.ink)
                        Spacer(Modifier.height(4.dp))
                        Text("Allow notification access and I'll note every payment alert from your bank, card or UPI apps automatically. It never leaves your phone.",
                            style = Type.small, color = c.muted)
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("Allow access", Modifier.weight(1f)) {
                        store.updateSettings { it.copy(autoTrack = true) }
                        if (!listening) openListenerSettings(ctx)
                    }
                    GhostButton("Not now", Modifier.weight(1f)) { store.updateSettings { it.copy(hideSetupCard = true) } }
                }
                if (store.settings.autoTrack && !listening) {
                    Spacer(Modifier.height(10.dp))
                    Text("If Android says “Restricted setting”: open App info → ⋮ → Allow restricted settings, then try again.",
                        style = Type.small, color = c.clay, modifier = Modifier.press { openAppInfo(ctx) })
                }
            }
        }

        // Spent this month + line chart
        Reveal(1) {
            MCard {
                Eyebrow("Spent this month")
                Spacer(Modifier.height(6.dp))
                Text(fmt(animatedValue(spent)), style = Type.display, color = c.ink)
                Spacer(Modifier.height(2.dp))
                val diff = spent - lastSpentSameDay
                val line = when {
                    txs.none { it.month == last } -> if (earned > 0) "${fmt(earned)} earned so far" else "Your first month — keep logging"
                    diff > 0 -> "${fmt(diff)} more than this point last month"
                    else -> "${fmt(-diff)} less than this point last month"
                }
                Text(line, style = Type.small, color = if (diff > 0 && txs.any { it.month == last }) c.clay else c.sage)
                Spacer(Modifier.height(18.dp))
                SpendLine(
                    current = cumulative(txs, ym, today.dayOfMonth),
                    previous = cumulative(txs, last, last.lengthOfMonth()),
                    days = maxOf(ym.lengthOfMonth(), last.lengthOfMonth()),
                    modifier = Modifier.fillMaxWidth().height(120.dp),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LegendDot(c.clay); Text(" This month", style = Type.small, color = c.muted)
                    Spacer(Modifier.width(14.dp))
                    LegendDot(c.faint); Text(" Last month", style = Type.small, color = c.muted)
                }
            }
        }

        // In / Out / Left
        Reveal(2) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MiniStat("In", fmt(animatedValue(earned)), c.sage, Modifier.weight(1f))
                MiniStat("Out", fmt(animatedValue(spent)), c.clay, Modifier.weight(1f))
                val left = earned - spent
                MiniStat(if (left >= 0) "Kept" else "Over", fmt(animatedValue(kotlin.math.abs(left))), c.ink, Modifier.weight(1f))
            }
        }

        // Guide preview
        if (report.tips.isNotEmpty()) Reveal(3) { BuddyAdvice(report, fmt, onGuide) }

        // Category breakdown
        val cats = month.filter { !it.isIncome }.groupBy { it.category }.mapValues { e -> e.value.sumOf { it.amount } }
            .toList().sortedByDescending { it.second }
        if (cats.isNotEmpty()) Reveal(4) {
            MCard {
                Eyebrow("Where it went")
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val top = cats.take(5)
                    val rest = cats.drop(5).sumOf { it.second }
                    val parts = top.map { Color(it.first.color) to it.second.toFloat() } +
                        (if (rest > 0) listOf(c.faint to rest.toFloat()) else emptyList())
                    Donut(parts, Modifier.size(124.dp)) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(cats.size.toString(), style = Type.title, color = c.ink)
                            Text("categories", style = Type.small, color = c.muted)
                        }
                    }
                    Spacer(Modifier.width(18.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        top.forEach { (cat, v) ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                LegendDot(Color(cat.color))
                                Text(" " + cat.label, style = Type.small, color = c.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("${(v / spent * 100).toInt()}%", style = Type.small, color = c.muted)
                            }
                        }
                    }
                }
            }
        }

        // Six-month bars
        if (txs.isNotEmpty()) Reveal(5) {
            MCard {
                Eyebrow("Last 6 months")
                Spacer(Modifier.height(16.dp))
                val months = (5 downTo 0).map { ym.minusMonths(it.toLong()) }
                Bars(months.map { m -> txs.inMonth(m).spent().toFloat() }, highlight = 5, modifier = Modifier.fillMaxWidth().height(96.dp))
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth()) {
                    months.forEach { m ->
                        Text(m.month.getDisplayName(JTextStyle.SHORT, Locale.getDefault()), style = Type.small,
                            color = if (m == ym) c.ink else c.muted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                    }
                }
            }
        }

        // Recent
        if (txs.isNotEmpty()) Reveal(6) {
            MCard(pad = 8.dp) {
                Row(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
                    Eyebrow("Recent", Modifier.weight(1f))
                    Text("See all", style = Type.small, color = c.clay, modifier = Modifier.press(onSeeAll))
                }
                txs.take(5).forEach { TxRow(it, fmt) { onOpen(it) } }
            }
        } else Reveal(4) {
            MCard(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Spacer(Modifier.height(12.dp)); Bloom(40.dp); Spacer(Modifier.height(14.dp))
                    Text("Nothing logged yet", style = Type.heading, color = c.ink)
                    Text("Tap + to add your income or a purchase,", style = Type.small, color = c.muted)
                    Text("or bring in your history from your bank.", style = Type.small, color = c.muted)
                    Spacer(Modifier.height(14.dp))
                    GhostButton("Import a bank statement", Modifier.fillMaxWidth(), onClick = onImport)
                }
            }
        }
    }
}

/** The little advisor with a speech bubble. Tap him for the next tip. */
@Composable
private fun BuddyAdvice(report: Report, fmt: (Double) -> String, onGuide: () -> Unit) {
    val c = Moli.c
    var i by rememberSaveable { mutableIntStateOf(0) }
    val tip = report.tips[i % report.tips.size]
    val mood = when (tip.tone) { Tone.WARN -> Mood.CONCERNED; Tone.IDEA -> Mood.HAPPY; Tone.GOOD -> Mood.HAPPY }
    Row(verticalAlignment = Alignment.Top) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Buddy(74.dp, mood, Modifier.press { i++ })
            Text("tap me", style = Type.small.copy(fontSize = 11.sp), color = c.faint)
        }
        Spacer(Modifier.width(4.dp))
        Box(Modifier.weight(1f).clip(BubbleShape()).background(c.card).border(1.dp, c.line, BubbleShape()).padding(start = 9.dp)) {
            AnimatedContent(tip, transitionSpec = { (fadeIn(tween(300)) + slideInVertically(tween(350)) { it / 12 }) togetherWith fadeOut(tween(150)) },
                label = "tip") { t ->
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Eyebrow("Moli says", Modifier.weight(1f))
                        if (t.saving > 0 && t.counts) Text("+${fmt(t.saving)}/mo", style = Type.small, color = c.sage)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(t.title, style = Type.heading, color = c.ink)
                    Spacer(Modifier.height(4.dp))
                    StreamText(t.body, Type.body, c.muted, startDelay = 400, key = "home_" + t.id + t.body.hashCode())
                    Spacer(Modifier.height(10.dp))
                    Row {
                        Text("${(i % report.tips.size) + 1} of ${report.tips.size}", style = Type.small, color = c.faint, modifier = Modifier.weight(1f))
                        Text("All suggestions →", style = Type.small, color = c.clay, modifier = Modifier.press(onGuide))
                    }
                }
            }
        }
    }
}

@Composable
fun LegendDot(col: Color) = Box(Modifier.size(8.dp).clip(CircleShape).background(col))

@Composable
private fun MiniStat(label: String, value: String, col: Color, modifier: Modifier) {
    MCard(modifier, pad = 14.dp) {
        Eyebrow(label)
        Spacer(Modifier.height(4.dp))
        Text(value, style = Type.heading, color = col, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
