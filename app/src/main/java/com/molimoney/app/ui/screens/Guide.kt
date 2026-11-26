package com.molimoney.app.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.molimoney.app.data.Store
import com.molimoney.app.logic.Advisor
import com.molimoney.app.logic.Tone
import com.molimoney.app.logic.Mood
import com.molimoney.app.ui.components.Buddy
import com.molimoney.app.ui.components.Bloom
import com.molimoney.app.ui.components.Eyebrow
import com.molimoney.app.ui.components.MCard
import com.molimoney.app.ui.components.Reveal
import com.molimoney.app.ui.components.SplitBar
import com.molimoney.app.ui.components.StreamText
import com.molimoney.app.ui.components.Streamed
import com.molimoney.app.ui.components.animatedValue
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type
import kotlinx.coroutines.delay

private var thoughtOnce = false

@Composable
fun GuideScreen(store: Store, fmt: (Double) -> String) {
    val c = Moli.c
    val txs = store.txs.toList()
    val report = remember(txs, store.settings) { Advisor.analyze(txs, store.settings, fmt) }
    var thinking by remember { mutableStateOf(!thoughtOnce) }
    LaunchedEffect(Unit) { if (thinking) { delay(1400); thinking = false; thoughtOnce = true } }

    Column(
        Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 32.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Buddy(54.dp, when { thinking -> Mood.THINKING; report.tips.any { it.tone == Tone.WARN } -> Mood.CONCERNED; else -> Mood.HAPPY })
            Spacer(Modifier.width(10.dp))
            Column {
                Text("Your guide", style = Type.title, color = c.ink)
                AnimatedContent(thinking, transitionSpec = { fadeIn(tween(300)) togetherWith fadeOut(tween(200)) }, label = "t") { t ->
                    Text(if (t) "Looking through your spending…" else "Based on ${txs.size} transactions", style = Type.small, color = c.muted)
                }
            }
        }

        if (!thinking) {
            if (report.hasData && report.potential > 0) Reveal(0) {
                MCard(Modifier.fillMaxWidth()) {
                    Eyebrow("You could keep about")
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(fmt(animatedValue(report.potential, 1400)), style = Type.display, color = c.clay)
                        Text(" / month", style = Type.body, color = c.muted, modifier = Modifier.padding(bottom = 8.dp))
                    }
                    Text("That's ${fmt(report.potential * 12)} a year, from the ideas below.", style = Type.small, color = c.muted)
                }
            }

            if (report.income > 0) Reveal(1) {
                MCard {
                    Eyebrow("Your typical month")
                    Spacer(Modifier.height(14.dp))
                    val inc = report.income
                    val over = (report.needs + report.wants - inc).coerceAtLeast(0.0)
                    SplitBar(
                        listOf(Color(0xFF8A93A6) to report.needs.toFloat(), c.clay to report.wants.toFloat(), c.sage to report.saved.toFloat()),
                        Modifier.fillMaxWidth().height(12.dp),
                    )
                    Spacer(Modifier.height(14.dp))
                    Split("Needs", report.needs / inc, 0.50, Color(0xFF8A93A6), fmt(report.needs))
                    Split("Wants", report.wants / inc, 0.30, c.clay, fmt(report.wants))
                    Split("Saved", report.saved / inc, store.settings.goalPct / 100.0, c.sage, fmt(report.saved))
                    if (over > 0) Text("You spend ${fmt(over)} more than you earn in a typical month.", style = Type.small, color = c.clay,
                        modifier = Modifier.padding(top = 6.dp))
                    Spacer(Modifier.height(4.dp))
                    Text("Target split: 50 / 30 / ${store.settings.goalPct}", style = Type.small, color = c.faint)
                }
            }

            Eyebrow("Suggestions", Modifier.padding(top = 8.dp, start = 4.dp))
            report.tips.forEachIndexed { i, tip ->
                Reveal(2 + i) {
                    MCard(Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            val col = when (tip.tone) { Tone.WARN -> c.clay; Tone.IDEA -> c.ochre; Tone.GOOD -> c.sage }
                            Box(Modifier.size(8.dp).clip(CircleShape).background(col))
                            Spacer(Modifier.width(8.dp))
                            Eyebrow(when (tip.tone) { Tone.WARN -> "Heads up"; Tone.IDEA -> "Idea"; Tone.GOOD -> "Nice" })
                            Spacer(Modifier.weight(1f))
                            if (tip.saving > 0 && tip.counts) Text(
                                "+${fmt(tip.saving)}/mo", style = Type.small, color = c.sage,
                                modifier = Modifier.clip(RoundedCornerShape(50)).background(c.sage.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 4.dp),
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(tip.title, style = Type.heading, color = c.ink)
                        Spacer(Modifier.height(6.dp))
                        val key = "g_" + tip.id + tip.body.hashCode()
                        StreamText(tip.body, Type.body, c.muted, startDelay = if (key in Streamed.seen) 0 else 250L + i * 380L, key = key)
                    }
                }
            }

            Reveal(3 + report.tips.size) {
                Text(
                    "How this works: I compare this month with your average of the previous three, check your split against the 50/30/20 rule, " +
                        "and look for repeating charges, small frequent buys and weekend spikes. Savings are estimates — everything stays on your phone.",
                    style = Type.small, color = c.faint, modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun Split(label: String, share: Double, target: Double, col: Color, amount: String) {
    val c = Moli.c
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(col))
        Text("  $label", style = Type.body, color = c.ink, modifier = Modifier.weight(1f))
        Text(amount, style = Type.small, color = c.muted)
        Spacer(Modifier.width(10.dp))
        val pct = (share * 100).toInt().coerceAtLeast(0)
        val good = if (label == "Saved") share >= target else share <= target
        Text("$pct%", style = Type.body, color = if (good) c.sage else c.clay, modifier = Modifier.width(44.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.End)
    }
}
