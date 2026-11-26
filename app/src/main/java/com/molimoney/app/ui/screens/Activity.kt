package com.molimoney.app.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.molimoney.app.data.Tx
import com.molimoney.app.data.Store
import com.molimoney.app.data.earned
import com.molimoney.app.data.inMonth
import com.molimoney.app.data.spent
import com.molimoney.app.ui.components.Bloom
import com.molimoney.app.ui.components.Eyebrow
import com.molimoney.app.ui.components.Reveal
import com.molimoney.app.ui.components.press
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter

@Composable
fun ActivityScreen(store: Store, fmt: (Double) -> String, onOpen: (Tx) -> Unit) {
    val c = Moli.c
    var offset by rememberSaveable { mutableStateOf(0L) }
    val now = YearMonth.now()
    val ym = now.minusMonths(offset)
    val month = store.txs.toList().inMonth(ym)

    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(32.dp))
        Reveal(0) { Text("Activity", style = Type.title, color = c.ink) }
        Spacer(Modifier.height(14.dp))
        Reveal(1) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Arrow(Icons.Filled.KeyboardArrowLeft) { offset++ }
                AnimatedContent(ym, Modifier.weight(1f), transitionSpec = {
                    val dir = if (targetState > initialState) 1 else -1
                    (fadeIn(tween(300)) + slideInHorizontally(tween(300)) { dir * it / 4 }) togetherWith
                        (fadeOut(tween(200)) + slideOutHorizontally(tween(300)) { -dir * it / 4 })
                }, label = "month") { m ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                        Text(m.format(DateTimeFormatter.ofPattern("MMMM yyyy")), style = Type.heading, color = c.ink)
                        val list = store.txs.toList().inMonth(m)
                        Text("In ${fmt(list.earned())}  ·  Out ${fmt(list.spent())}", style = Type.small, color = c.muted)
                    }
                }
                Arrow(Icons.Filled.KeyboardArrowRight, enabled = offset > 0) { if (offset > 0) offset-- }
            }
        }
        Spacer(Modifier.height(8.dp))
        if (month.isEmpty()) {
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Bloom(36.dp, color = c.faint)
                    Spacer(Modifier.height(12.dp))
                    Text("Nothing logged this month", style = Type.body, color = c.muted)
                }
            }
        } else {
            val groups = month.groupBy { it.day }.toSortedMap(compareByDescending { it })
            val today = LocalDate.now().toEpochDay()
            LazyColumn(contentPadding = PaddingValues(bottom = 100.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                groups.forEach { (day, list) ->
                    item(key = "h$day") {
                        val label = when (day) {
                            today -> "Today"; today - 1 -> "Yesterday"
                            else -> LocalDate.ofEpochDay(day).format(DateTimeFormatter.ofPattern("EEEE, d MMM"))
                        }
                        Row(Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 4.dp, start = 10.dp, end = 10.dp).animateItem()) {
                            Eyebrow(label, Modifier.weight(1f))
                            val out = list.spent()
                            if (out > 0) Text(fmt(out), style = Type.small, color = c.muted)
                        }
                    }
                    items(list, key = { it.id }) { tx -> TxRow(tx, fmt, Modifier.animateItem()) { onOpen(tx) } }
                }
            }
        }
    }
}

@Composable
private fun Arrow(icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Moli.c
    Box(Modifier.size(40.dp).clip(CircleShape).press(onClick), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = if (enabled) c.ink else c.line)
    }
}
