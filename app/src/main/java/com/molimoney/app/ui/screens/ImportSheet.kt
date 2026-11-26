package com.molimoney.app.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.molimoney.app.data.Store
import com.molimoney.app.data.Tx
import com.molimoney.app.logic.ImportResult
import com.molimoney.app.logic.Mood
import com.molimoney.app.logic.money
import com.molimoney.app.ui.components.BubbleShape
import com.molimoney.app.ui.components.Buddy
import com.molimoney.app.ui.components.CatBadge
import com.molimoney.app.ui.components.Eyebrow
import com.molimoney.app.ui.components.GhostButton
import com.molimoney.app.ui.components.PrimaryButton
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type
import kotlinx.coroutines.launch
import java.time.format.DateTimeFormatter

sealed interface ImportState {
    data object Reading : ImportState
    data class Ready(val result: ImportResult) : ImportState
    data class Failed(val message: String) : ImportState
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportSheet(store: Store, state: ImportState, onPickAnother: () -> Unit, onDismiss: () -> Unit) {
    val c = Moli.c
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    fun close() = scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss() }
    val cur = store.settings.currency

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = c.bg,
        dragHandle = { Box(Modifier.padding(top = 10.dp, bottom = 6.dp).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.line)) }) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp)) {
            val mood = when (state) { ImportState.Reading -> Mood.THINKING; is ImportState.Failed -> Mood.CONCERNED; is ImportState.Ready -> if (state.result.rows.isEmpty()) Mood.CONCERNED else Mood.HAPPY }
            val say = when (state) {
                ImportState.Reading -> "Reading your statement…"
                is ImportState.Failed -> state.message + " Export a CSV (or OFX) from your bank's app or website and try again."
                is ImportState.Ready -> if (state.result.rows.isEmpty()) "Everything in this file is already in Moli (${state.result.duplicates} duplicates). Nothing new to add."
                else "I found ${state.result.rows.size} new transactions" + (if (state.result.duplicates > 0) " and skipped ${state.result.duplicates} you already have" else "") + ". I've guessed categories; you can change any of them later."
            }
            Row(verticalAlignment = Alignment.Top) {
                Buddy(64.dp, mood)
                Spacer(Modifier.width(4.dp))
                AnimatedContent(say, Modifier.weight(1f), transitionSpec = { fadeIn(tween(300)) togetherWith fadeOut(tween(150)) }, label = "say") { s ->
                    Box(Modifier.clip(BubbleShape()).background(c.card).padding(start = 9.dp)) {
                        Text(s, style = Type.body, color = c.ink, modifier = Modifier.padding(14.dp))
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            when (state) {
                ImportState.Reading -> Spacer(Modifier.height(40.dp))
                is ImportState.Failed -> {
                    PrimaryButton("Choose another file", Modifier.fillMaxWidth(), onClick = onPickAnother)
                    Spacer(Modifier.height(8.dp))
                    GhostButton("Close", Modifier.fillMaxWidth()) { close() }
                }
                is ImportState.Ready -> {
                    val rows = state.result.rows
                    if (rows.isNotEmpty()) {
                        val out = rows.filter { !it.income }.sumOf { it.amount }
                        val inn = rows.filter { it.income }.sumOf { it.amount }
                        val f = DateTimeFormatter.ofPattern("d MMM yyyy")
                        Eyebrow("${rows.last().date.format(f)} – ${rows.first().date.format(f)}")
                        Spacer(Modifier.height(4.dp))
                        Text("Out ${money(out, cur)}  ·  In ${money(inn, cur)}", style = Type.small, color = c.muted)
                        Spacer(Modifier.height(10.dp))
                        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 300.dp).clip(RoundedCornerShape(16.dp)).background(c.card)) {
                            items(rows.take(300)) { r ->
                                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    CatBadge(r.category, 32.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(r.desc, style = Type.small, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(r.category.label + " · " + r.date.format(DateTimeFormatter.ofPattern("d MMM")), style = Type.small, color = c.muted)
                                    }
                                    Text((if (r.income) "+" else "") + money(r.amount, cur, true), style = Type.small.copy(fontWeight = FontWeight.Medium),
                                        color = if (r.income) c.sage else c.ink)
                                }
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                        PrimaryButton("Import ${rows.size} transactions", Modifier.fillMaxWidth()) {
                            val base = store.newId()
                            store.addAll(rows.mapIndexed { k, r ->
                                Tx(base + k + 1, r.amount, r.category, r.desc, r.date.toEpochDay(), source = "i")
                            })
                            repeat(rows.size) { store.newId() }
                            close()
                        }
                    } else GhostButton("Close", Modifier.fillMaxWidth()) { close() }
                }
            }
        }
    }
}
