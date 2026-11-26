package com.molimoney.app.logic

/** Pulls an amount, direction and merchant out of a bank / card / UPI payment alert. */
object NotifParser {
    data class Parsed(val amount: Double, val income: Boolean, val merchant: String)

    private val money = Regex(
        "(?i)(?:₹|rs\\.?|inr|\\$|usd|us\\$|€|eur|£|gbp|a\\$|aud|¥|₩|r\\$)\\s?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)" +
            "|([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s?(?:₹|rs\\.?|inr|usd|eur|gbp|aud)\\b",
    )
    private val debit = Regex("(?i)\\b(debited|spent|paid|payment of|purchase|sent|withdrawn|charged|transaction of|txn of|used at|you paid|debit)\\b")
    private val credit = Regex("(?i)\\b(credited|received|deposited|refund(ed)?|cashback|salary)\\b")
    private val noise = Regex("(?i)\\b(otp|one time password|will be debited|due (on|date)|bill (is )?generated|reminder|request(ed)? (money|payment)|collect request|is requesting|failed|declined|reversed|minimum amount|statement)\\b")

    fun parse(title: String, text: String): Parsed? {
        val all = "$title. $text".replace('\n', ' ')
        if (noise.containsMatchIn(all)) return null
        val m = money.find(all) ?: return null
        val amount = (m.groupValues[1].ifEmpty { m.groupValues[2] }).replace(",", "").toDoubleOrNull() ?: return null
        if (amount <= 0) return null
        val isDebit = debit.containsMatchIn(all)
        val isCredit = credit.containsMatchIn(all)
        if (!isDebit && !isCredit) return null
        val income = isCredit && !isDebit
        return Parsed(amount, income, merchant(all, income) ?: "")
    }

    private val stop = "(?=\\s+(?:on|via|using|ref|refno|upi|from|with|is|was|has|for|txn|a/c|ac|acct|avl|available|bal|info|thru|through)\\b|[.,;!()]|\\s-\\s|$)"

    private fun merchant(s: String, income: Boolean): String? {
        val preps = if (income) listOf("from", "by") else listOf("at", "to", "towards", "for", "@")
        for (p in preps) {
            val r = Regex("(?i)(?:^|\\s)" + Regex.escape(p) + "\\s+([A-Za-z0-9&'._*@\\- ]{2,40}?)$stop")
            for (m in r.findAll(s)) {
                val c = clean(m.groupValues[1]) ?: continue
                return c
            }
        }
        return null
    }

    private fun clean(raw: String): String? {
        var s = raw.trim()
        s = s.replace(Regex("(?i)^(vpa|upi[-:]?|mr\\.?|ms\\.?|m/s\\.?|the|your|merchant)\\s*"), "")
        if (s.contains('@')) s = s.substringBefore('@')
        s = s.replace(Regex("[._*]+"), " ").trim()
        if (s.length < 2) return null
        if (Regex("(?i)^(a/?c|account|card|your|xx|\\*|rs|inr|\\d)").containsMatchIn(s)) return null
        if (s.count { it.isDigit() } > s.length / 2) return null
        return s.split(' ').filter { it.isNotBlank() }.joinToString(" ") { w ->
            if (w.length <= 3 && w.all { it.isUpperCase() }) w else w.lowercase().replaceFirstChar { it.uppercase() }
        }
    }
}
