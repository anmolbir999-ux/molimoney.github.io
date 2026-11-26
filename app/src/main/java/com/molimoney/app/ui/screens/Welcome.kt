package com.molimoney.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.molimoney.app.data.Store
import com.molimoney.app.ui.components.Bloom
import com.molimoney.app.ui.components.Chip
import com.molimoney.app.ui.components.Eyebrow
import com.molimoney.app.ui.components.GhostButton
import com.molimoney.app.ui.components.PrimaryButton
import com.molimoney.app.ui.components.Reveal
import com.molimoney.app.ui.components.StreamText
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type

val Currencies = listOf("$", "€", "£", "₹", "¥", "₩", "R$", "A$")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WelcomeScreen(store: Store) {
    val c = Moli.c
    var name by rememberSaveable { mutableStateOf("") }
    var cur by rememberSaveable { mutableStateOf(defaultCurrency()) }
    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()
            .verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.height(64.dp))
        Reveal(0) { Bloom(64.dp) }
        Spacer(Modifier.height(28.dp))
        StreamText("Hello. I'm Moli.", Type.display, c.ink, startDelay = 300, perWord = 140, key = "w1")
        Spacer(Modifier.height(12.dp))
        StreamText("A quiet guide for your money. Tell me what comes in and what goes out, and I'll show you where you could keep more.",
            Type.body.copy(fontSize = Type.body.fontSize * 1.08f), c.muted, startDelay = 900, perWord = 34, key = "w2")
        Spacer(Modifier.height(36.dp))
        Reveal(8) {
            Column {
                Eyebrow("What should I call you?")
                Spacer(Modifier.height(10.dp))
                Field(name, { name = it }, "Your name (optional)")
                Spacer(Modifier.height(24.dp))
                Eyebrow("Currency")
                Spacer(Modifier.height(10.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Currencies.forEach { s -> Chip(s, s == cur) { cur = s } }
                }
            }
        }
        Spacer(Modifier.weight(1f).height(40.dp))
        Reveal(10) {
            Column {
                PrimaryButton("Start fresh", Modifier.fillMaxWidth()) {
                    store.updateSettings { it.copy(name = name.trim(), currency = cur, onboarded = true) }
                }
                Spacer(Modifier.height(10.dp))
                GhostButton("Explore with sample data", Modifier.fillMaxWidth()) {
                    store.updateSettings { it.copy(name = name.trim(), currency = cur, onboarded = true) }
                    store.loadSample()
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

private fun defaultCurrency(): String = runCatching {
    when (java.util.Currency.getInstance(java.util.Locale.getDefault()).currencyCode) {
        "INR" -> "₹"; "EUR" -> "€"; "GBP" -> "£"; "JPY", "CNY" -> "¥"; "KRW" -> "₩"; "BRL" -> "R$"; "AUD" -> "A$"; else -> "$"
    }
}.getOrDefault("$")
