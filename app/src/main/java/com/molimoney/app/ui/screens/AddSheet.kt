package com.molimoney.app.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.molimoney.app.data.Category
import com.molimoney.app.data.Store
import com.molimoney.app.data.Tx
import com.molimoney.app.ui.components.Chip
import com.molimoney.app.ui.components.Eyebrow
import com.molimoney.app.ui.components.PrimaryButton
import com.molimoney.app.ui.components.press
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AddSheet(store: Store, editing: Tx?, onDismiss: () -> Unit) {
    val c = Moli.c
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var income by remember { mutableStateOf(editing?.isIncome ?: false) }
    var amount by remember { mutableStateOf(editing?.amount?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() } ?: "") }
    var cat by remember { mutableStateOf(editing?.category ?: Category.Groceries) }
    var note by remember { mutableStateOf(editing?.note ?: "") }
    var day by remember { mutableLongStateOf(editing?.day ?: LocalDate.now().toEpochDay()) }
    var picking by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (editing == null) { delay(350); runCatching { focus.requestFocus() } } }

    fun close() = scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss() }
    val value = amount.replace(',', '.').toDoubleOrNull() ?: 0.0

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = c.bg,
        dragHandle = { Box(Modifier.padding(top = 10.dp, bottom = 6.dp).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.line)) }) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding()
                .padding(horizontal = 20.dp).padding(bottom = 16.dp),
        ) {
            // Expense / Income toggle with sliding indicator
            BoxWithConstraints(Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(50)).background(c.card)) {
                val half = maxWidth / 2
                val x by animateDpAsState(if (income) half else 0.dp, spring(dampingRatio = 0.75f, stiffness = 500f), label = "seg")
                Box(Modifier.offset(x = x).width(half).fillMaxHeight().padding(4.dp).clip(RoundedCornerShape(50)).background(c.ink))
                Row(Modifier.fillMaxWidth().fillMaxHeight()) {
                    listOf(false to "Expense", true to "Income").forEach { (inc, label) ->
                        val fg by animateColorAsState(if (income == inc) c.bg else c.muted, tween(250), label = "segfg")
                        Box(Modifier.weight(1f).fillMaxHeight().press {
                            income = inc
                            if (cat.isIncome != inc) cat = if (inc) Category.Salary else Category.Groceries
                        }, contentAlignment = Alignment.Center) {
                            Text(label, style = Type.small.copy(fontWeight = FontWeight.Medium), color = fg)
                        }
                    }
                }
            }
            Spacer(Modifier.height(26.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text(store.settings.currency, style = Type.display, color = c.faint)
                Spacer(Modifier.width(4.dp))
                Box {
                    if (amount.isEmpty()) Text("0", style = Type.display, color = c.line)
                    BasicTextField(
                        amount, { s -> if (s.length <= 12 && s.count { it == '.' || it == ',' } <= 1 && s.all { it.isDigit() || it == '.' || it == ',' }) amount = s },
                        singleLine = true, textStyle = Type.display.copy(color = if (income) c.sage else c.ink),
                        cursorBrush = SolidColor(c.clay), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.focusRequester(focus).width(androidx.compose.ui.unit.max(40.dp, (amount.length * 24 + 16).dp)),
                    )
                }
            }
            Spacer(Modifier.height(24.dp))
            Eyebrow("Category")
            Spacer(Modifier.height(10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                (if (income) Category.incomes else Category.expenses).forEach { k ->
                    Chip(k.label, k == cat, dot = Color(k.color)) { cat = k }
                }
            }
            Spacer(Modifier.height(20.dp))
            Eyebrow("Note")
            Spacer(Modifier.height(10.dp))
            Field(note, { note = it }, if (income) "e.g. Salary" else "What was it? e.g. Coffee")
            Spacer(Modifier.height(20.dp))
            Eyebrow("When")
            Spacer(Modifier.height(10.dp))
            val today = LocalDate.now().toEpochDay()
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Today", day == today) { day = today }
                Chip("Yesterday", day == today - 1) { day = today - 1 }
                val other = day != today && day != today - 1
                Chip(if (other) LocalDate.ofEpochDay(day).format(DateTimeFormatter.ofPattern("d MMM yyyy")) else "Pick a date…", other) { picking = true }
            }
            Spacer(Modifier.height(28.dp))
            PrimaryButton(if (editing == null) "Save" else "Update", Modifier.fillMaxWidth(), enabled = value > 0) {
                store.upsert(Tx(editing?.id ?: store.newId(), value, cat, note.trim(), day))
                close()
            }
            if (editing != null) {
                Spacer(Modifier.height(6.dp))
                TextButton({ store.remove(editing.id); close() }, Modifier.fillMaxWidth()) { Text("Delete", color = c.clay) }
            }
        }
    }

    if (picking) {
        val st = rememberDatePickerState(
            initialSelectedDateMillis = LocalDate.ofEpochDay(day).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton({
                    st.selectedDateMillis?.let { day = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toEpochDay() }
                    picking = false
                }) { Text("OK", color = c.clay) }
            },
            dismissButton = { TextButton({ picking = false }) { Text("Cancel", color = c.muted) } },
            colors = DatePickerDefaults.colors(containerColor = c.card),
        ) {
            DatePicker(st, colors = DatePickerDefaults.colors(
                containerColor = c.card, selectedDayContainerColor = c.clay, todayDateBorderColor = c.clay, todayContentColor = c.clay,
            ))
        }
    }
}
