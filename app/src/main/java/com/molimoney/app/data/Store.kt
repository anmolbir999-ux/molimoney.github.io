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
    /** Signatures of payment notifications already logged, so re-posts aren't counted twice. */
    private val seen = ArrayDeque<String>()
    private var lastId = 0L

    init { load() }

    private fun load() {
        if (!file.exists()) return
        runCatching {
            val o = JSONObject(file.readText())
            o.optJSONObject("settings")?.let { s ->
                val d = Settings()
                settings = Settings(
                    name = s.optString("name", d.name),
                    currency = s.optString("currency", d.currency),
                    goalPct = s.optInt("goalPct", d.goalPct),
                    onboarded = s.optBoolean("onboarded", d.onboarded),
                    wrapped = s.optBoolean("wrapped", d.wrapped),
                    wrappedHour = s.optInt("wrappedHour", d.wrappedHour),
                    autoTrack = s.optBoolean("autoTrack", d.autoTrack),
                    askedNotif = s.optBoolean("askedNotif", d.askedNotif),
                    hideSetupCard = s.optBoolean("hideSetupCard", d.hideSetupCard),
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
                    source = t.optString("src", "m"),
                )
            }
            txs.clear(); txs.addAll(list); resort()
            o.optJSONArray("seen")?.let { a -> for (i in 0 until a.length()) seen.addLast(a.getString(i)) }
        }
    }

    @Synchronized
    private fun save() {
        val o = JSONObject()
        o.put("settings", JSONObject().apply {
            val s = settings
            put("name", s.name); put("currency", s.currency); put("goalPct", s.goalPct); put("onboarded", s.onboarded)
            put("wrapped", s.wrapped); put("wrappedHour", s.wrappedHour); put("autoTrack", s.autoTrack)
            put("askedNotif", s.askedNotif); put("hideSetupCard", s.hideSetupCard)
        })
        o.put("txs", JSONArray().apply {
            txs.forEach { t ->
                put(JSONObject().apply {
                    put("id", t.id); put("amount", t.amount); put("cat", t.category.name)
                    put("note", t.note); put("day", t.day); put("src", t.source)
                })
            }
        })
        o.put("seen", JSONArray(seen.toList()))
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

    fun addAll(list: List<Tx>) { txs.addAll(list); resort(); save() }

    fun remove(id: Long) { txs.removeAll { it.id == id }; save() }

    fun updateSettings(f: (Settings) -> Settings) { settings = f(settings); save() }

    fun loadSample() { txs.clear(); txs.addAll(Sample.generate(settings.currency)); resort(); save() }

    fun eraseAll() { txs.clear(); save() }

    /** Returns false if [sig] was already recorded. */
    @Synchronized
    fun markSeen(sig: String): Boolean {
        if (sig in seen) return false
        seen.addLast(sig); while (seen.size > 300) seen.removeFirst()
        return true
    }

    @Synchronized
    fun newId(): Long {
        val t = System.currentTimeMillis()
        lastId = if (t > lastId) t else lastId + 1
        return lastId
    }
}
