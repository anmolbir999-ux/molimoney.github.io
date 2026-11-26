package com.molimoney.app.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Tiny local-only store. Everything lives in one JSON file on the device. */
class Store(context: Context) {
    private val file = File(context.filesDir, "moli.json")

    val txs = mutableStateListOf<Tx>()
    var settings by mutableStateOf(Settings())
        private set

    init { load() }

    private fun load() {
        if (!file.exists()) return
        runCatching {
            val o = JSONObject(file.readText())
            o.optJSONObject("settings")?.let { s ->
                settings = Settings(
                    name = s.optString("name", ""),
                    currency = s.optString("currency", "$"),
                    goalPct = s.optInt("goalPct", 20),
                    onboarded = s.optBoolean("onboarded", false),
                )
            }
            val arr = o.optJSONArray("txs") ?: JSONArray()
            val list = (0 until arr.length()).map { i ->
                val t = arr.getJSONObject(i)
                Tx(
                    id = t.getLong("id"),
                    amount = t.getDouble("amount"),
                    category = Category.of(t.getString("cat")),
                    note = t.optString("note", ""),
                    day = t.getLong("day"),
                )
            }
            txs.clear(); txs.addAll(list.sortedByDescending { it.day * 100000 + it.id % 100000 })
        }
    }

    private fun save() {
        val o = JSONObject()
        o.put("settings", JSONObject().apply {
            put("name", settings.name); put("currency", settings.currency)
            put("goalPct", settings.goalPct); put("onboarded", settings.onboarded)
        })
        o.put("txs", JSONArray().apply {
            txs.forEach { t ->
                put(JSONObject().apply {
                    put("id", t.id); put("amount", t.amount); put("cat", t.category.name)
                    put("note", t.note); put("day", t.day)
                })
            }
        })
        val tmp = File(file.parentFile, "moli.json.tmp")
        tmp.writeText(o.toString())
        tmp.renameTo(file)
    }

    private fun resort() {
        val sorted = txs.sortedWith(compareByDescending<Tx> { it.day }.thenByDescending { it.id })
        txs.clear(); txs.addAll(sorted)
    }

    fun upsert(tx: Tx) {
        val i = txs.indexOfFirst { it.id == tx.id }
        if (i >= 0) txs[i] = tx else txs.add(tx)
        resort(); save()
    }

    fun remove(id: Long) { txs.removeAll { it.id == id }; save() }

    fun updateSettings(f: (Settings) -> Settings) { settings = f(settings); save() }

    fun loadSample() { txs.clear(); txs.addAll(Sample.generate(settings.currency)); resort(); save() }

    fun eraseAll() { txs.clear(); save() }

    fun newId() = System.currentTimeMillis()
}
