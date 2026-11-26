package com.molimoney.app.logic

import com.molimoney.app.data.Category
import com.molimoney.app.data.Tx
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.util.Locale
import kotlin.math.abs

data class ImportRow(val date: LocalDate, val amount: Double, val income: Boolean, val desc: String, val category: Category)

data class ImportResult(val rows: List<ImportRow>, val duplicates: Int)

/**
 * Reads bank statements exported as CSV (any delimiter, with or without headers,
 * single amount or separate debit/credit columns) or OFX/QFX.
 */
object StatementImport {

    class ImportError(msg: String) : Exception(msg)

    fun parse(raw: String, existing: List<Tx>, today: LocalDate = LocalDate.now()): ImportResult {
        val text = raw.removePrefix("\uFEFF")
        val rows = if (text.contains("<STMTTRN>", ignoreCase = true)) parseOfx(text) else parseCsv(text)
        if (rows.isEmpty()) throw ImportError("I couldn't find any transactions in that file.")
        val valid = rows.filter { !it.date.isAfter(today.plusDays(1)) && it.amount > 0 }
        // Skip rows that already exist (same day, amount and direction).
        val have = existing.map { Triple(it.day, Math.round(it.amount * 100), it.isIncome) }.toMutableSet()
        var dup = 0
        val fresh = valid.filter { r ->
            val k = Triple(r.date.toEpochDay(), Math.round(r.amount * 100), r.income)
            if (k in have) { dup++; false } else { have += k; true }
        }
        return ImportResult(fresh.sortedByDescending { it.date }, dup)
    }

    // ---------- OFX ----------
    private fun parseOfx(text: String): List<ImportRow> =
        text.split(Regex("(?i)<STMTTRN>")).drop(1).mapNotNull { block ->
            fun tag(t: String) = Regex("(?i)<$t>([^<\\r\\n]+)").find(block)?.groupValues?.get(1)?.trim()
            val d = tag("DTPOSTED")?.take(8) ?: return@mapNotNull null
            val date = runCatching { LocalDate.parse(d, DateTimeFormatter.BASIC_ISO_DATE) }.getOrNull() ?: return@mapNotNull null
            val amt = tag("TRNAMT")?.let { parseAmount(it) } ?: return@mapNotNull null
            val desc = listOfNotNull(tag("NAME"), tag("MEMO")).distinct().joinToString(" · ").ifBlank { "Transaction" }
            row(date, amt > 0, abs(amt), desc, signKnown = true)
        }

    // ---------- CSV ----------
    private enum class Role { DATE, DESC, AMOUNT, DEBIT, CREDIT, TYPE, IGNORE }

    private fun roleOf(h: String): Role? {
        val s = h.lowercase().trim()
        val toks = s.split(Regex("[^a-z]+")).filter { it.isNotEmpty() }.toSet()
        fun has(vararg k: String) = k.any { kw -> if (kw.contains(' ') || kw.contains('/')) s.contains(kw) else kw in toks }
        return when {
            has("balance", "bal") -> Role.IGNORE
            has("date", "dt", "posted", "posting", "datum", "fecha", "data", "buchungstag", "valuta") -> Role.DATE
            has("dr/cr", "cr/dr", "type", "indicator", "direction") -> Role.TYPE
            has("debit", "debits", "withdrawal", "withdrawals", "dr", "paid out", "money out", "out", "spent", "expense") -> Role.DEBIT
            has("credit", "credits", "deposit", "deposits", "cr", "paid in", "money in", "in", "received", "income") -> Role.CREDIT
            has("amount", "amt", "value", "sum", "betrag", "montant", "importe", "monto", "valor", "bedrag", "umsatz") -> Role.AMOUNT
            has("description", "narration", "details", "particulars", "merchant", "payee", "memo", "name", "remarks", "transaction", "info", "counterparty", "beneficiary", "buchungstext", "verwendungszweck", "libell", "concepto", "descripci", "beschreibung", "omschrijving", "empf") -> Role.DESC
            else -> null
        }
    }

    private fun parseCsv(text: String): List<ImportRow> {
        val lines = text.lines().filter { it.isNotBlank() }
        if (lines.isEmpty()) return emptyList()
        val delim = listOf(',', ';', '\t', '|').maxBy { d -> lines.take(15).sumOf { l -> l.count { it == d } } }
        val table = lines.map { splitCsv(it, delim) }

        // Find a header row within the first 40 lines.
        var headerIdx = -1
        var roles: List<Role?> = emptyList()
        for (i in 0 until minOf(40, table.size)) {
            val r = table[i].map { roleOf(it) }
            if (Role.DATE in r && (Role.AMOUNT in r || Role.DEBIT in r || Role.CREDIT in r)) { headerIdx = i; roles = r; break }
        }
        val body = table.drop(headerIdx + 1).filter { it.size >= 2 }
        if (body.isEmpty()) return emptyList()

        var dateCol = roles.indexOf(Role.DATE)
        var descCol = roles.indexOf(Role.DESC)
        var amtCol = roles.indexOf(Role.AMOUNT)
        val debitCol = roles.indexOf(Role.DEBIT)
        val creditCol = roles.indexOf(Role.CREDIT)
        val typeCol = roles.indexOf(Role.TYPE)
        val sample = body.take(200)
        val width = sample.maxOf { it.size }

        if (headerIdx < 0) {
            // No header: infer columns from content.
            dateCol = (0 until width).maxBy { c -> sample.count { r -> r.getOrNull(c)?.let { looksLikeDate(it) } == true } }
            amtCol = (0 until width).filter { it != dateCol }
                .firstOrNull { c -> sample.count { r -> r.getOrNull(c)?.let { parseAmount(it) } != null } > sample.size * 0.5 } ?: -1
        }
        if (descCol < 0) {
            val used = setOf(dateCol, amtCol, debitCol, creditCol, typeCol)
            descCol = (0 until width).filter { it !in used }
                .maxByOrNull { c -> sample.sumOf { r -> r.getOrNull(c)?.takeIf { parseAmount(it) == null }?.length ?: 0 } } ?: -1
        }
        if (dateCol < 0 || (amtCol < 0 && debitCol < 0 && creditCol < 0)) throw ImportError("I couldn't tell which columns hold the date and amount.")

        val fmt = pickDateFormat(sample.mapNotNull { it.getOrNull(dateCol) })
            ?: throw ImportError("I couldn't read the dates in that file.")

        val singleAmounts = if (amtCol >= 0) body.mapNotNull { it.getOrNull(amtCol)?.let { a -> parseAmount(a) } } else emptyList()
        val hasNegatives = singleAmounts.any { it < 0 }

        return body.mapNotNull { r ->
            val date = r.getOrNull(dateCol)?.let { parseDate(it, fmt) } ?: return@mapNotNull null
            val desc = r.getOrNull(descCol)?.trim().orEmpty().ifBlank { "Transaction" }
            val debit = r.getOrNull(debitCol)?.let { parseAmount(it) }?.let { abs(it) } ?: 0.0
            val credit = r.getOrNull(creditCol)?.let { parseAmount(it) }?.let { abs(it) } ?: 0.0
            when {
                debit > 0 -> row(date, false, debit, desc, true)
                credit > 0 -> row(date, true, credit, desc, true)
                amtCol >= 0 -> {
                    val a = r.getOrNull(amtCol)?.let { parseAmount(it) } ?: return@mapNotNull null
                    if (a == 0.0) return@mapNotNull null
                    val type = r.getOrNull(typeCol)?.lowercase()?.trim()
                    when {
                        type != null && (type.startsWith("cr") || type.contains("credit") || type.contains("deposit")) -> row(date, true, abs(a), desc, true)
                        type != null && (type.startsWith("dr") || type.contains("debit") || type.contains("withdraw")) -> row(date, false, abs(a), desc, true)
                        hasNegatives -> row(date, a > 0, abs(a), desc, true)
                        else -> row(date, false, abs(a), desc, false) // all positive: assume spending unless it reads like income
                    }
                }
                else -> null
            }
        }
    }

    private fun row(date: LocalDate, income: Boolean, amount: Double, desc: String, signKnown: Boolean): ImportRow {
        val inc = if (signKnown) income else Categorizer.looksLikeIncome(desc)
        val clean = desc.replace(Regex("\\s+"), " ").trim().take(60)
        return ImportRow(date, Math.round(amount * 100) / 100.0, inc, clean, Categorizer.guess(desc, inc))
    }

    fun splitCsv(line: String, d: Char): List<String> {
        val out = mutableListOf<String>()
        val sb = StringBuilder()
        var q = false
        var i = 0
        while (i < line.length) {
            val ch = line[i]
            when {
                ch == '"' && q && i + 1 < line.length && line[i + 1] == '"' -> { sb.append('"'); i++ }
                ch == '"' -> q = !q
                ch == d && !q -> { out += sb.toString().trim(); sb.clear() }
                else -> sb.append(ch)
            }
            i++
        }
        out += sb.toString().trim()
        return out
    }

    fun parseAmount(raw: String): Double? {
        var s = raw.trim()
        if (s.isEmpty() || s == "-") return null
        var neg = false
        if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.substring(1, s.length - 1) }
        val up = s.uppercase()
        if (up.endsWith("DR")) { neg = true; s = s.dropLast(2) } else if (up.endsWith("CR")) s = s.dropLast(2)
        if (Regex("[A-Za-z]{3,}").containsMatchIn(s.replace(Regex("(?i)rs\\.?|inr|usd|eur|gbp"), ""))) return null
        s = s.replace(Regex("[^0-9,.\\-]"), "")
        if (s.isEmpty() || s.none { it.isDigit() }) return null
        if (s.contains('-')) { neg = neg || s.startsWith("-") || s.endsWith("-"); s = s.replace("-", "") }
        s = when {
            Regex("^\\d{1,3}(\\.\\d{3})+,\\d{1,2}$").matches(s) -> s.replace(".", "").replace(',', '.')
            Regex("^\\d+,\\d{1,2}$").matches(s) -> s.replace(',', '.')
            else -> s.replace(",", "")
        }
        val v = s.toDoubleOrNull() ?: return null
        return if (neg) -v else v
    }

    private val datePatterns: List<DateTimeFormatter> by lazy {
        val dm = listOf("d/M/yyyy", "d-M-yyyy", "d.M.yyyy", "d/M/yy", "d-M-yy", "d.M.yy")
        val md = listOf("M/d/yyyy", "M-d-yyyy", "M/d/yy", "M-d-yy")
        val ordered = if (Locale.getDefault().country == "US") md + dm else dm + md
        (listOf("yyyy-M-d", "yyyy/M/d", "yyyy.M.d", "yyyyMMdd") + ordered + listOf(
            "d-MMM-yyyy", "d MMM yyyy", "d-MMM-yy", "d MMM yy", "d/MMM/yyyy", "MMM d, yyyy", "MMM d yyyy",
            "d MMMM yyyy", "MMMM d, yyyy", "d-MMMM-yyyy", "EEE, d MMM yyyy", "EEE MMM d yyyy",
        )).map { DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern(it).toFormatter(Locale.ENGLISH) }
    }

    private fun candidates(s: String): List<String> {
        val t = s.trim().trim('"')
        return listOfNotNull(t, t.substringBefore('T').takeIf { t.contains('T') && t.contains(':') },
            Regex("^(.*?)\\s+\\d{1,2}:\\d{2}.*$").find(t)?.groupValues?.get(1)).distinct()
    }

    fun parseDate(s: String, f: DateTimeFormatter): LocalDate? =
        candidates(s).firstNotNullOfOrNull { c -> runCatching { LocalDate.parse(c, f) }.getOrNull() }

    private fun looksLikeDate(s: String) = datePatterns.any { parseDate(s, it) != null }

    private fun pickDateFormat(values: List<String>): DateTimeFormatter? {
        if (values.isEmpty()) return null
        val today = LocalDate.now()
        val best = datePatterns.maxBy { f ->
            values.count { v -> val d = parseDate(v, f); d != null && !d.isAfter(today.plusDays(1)) }
        }
        return best.takeIf { f -> values.any { parseDate(it, f) != null } }
    }
}
