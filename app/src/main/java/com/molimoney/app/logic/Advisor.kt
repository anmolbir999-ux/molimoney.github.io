package com.molimoney.app.logic

import com.molimoney.app.data.Category
import com.molimoney.app.data.Kind
import com.molimoney.app.data.Settings
import com.molimoney.app.data.Tx
import com.molimoney.app.data.earned
import com.molimoney.app.data.inMonth
import com.molimoney.app.data.spent
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.max
import kotlin.math.roundToLong

enum class Tone { WARN, IDEA, GOOD }

data class Tip(
    val id: String,
    val tone: Tone,
    val title: String,
    val body: String,
    /** Estimated monthly saving if you act on it. */
    val saving: Double = 0.0,
    /** Whether [saving] adds to the headline "you could save" total. */
    val counts: Boolean = true,
)

data class Report(
    val income: Double,
    val expense: Double,
    val needs: Double,
    val wants: Double,
    val potential: Double,
    val tips: List<Tip>,
    val hasData: Boolean,
) {
    val saved get() = max(0.0, income - needs - wants)
}

/**
 * The guide's brain. A transparent set of rules that look at your typical month
 * (average of up to 3 previous months, or this month's pace when that's all there is)
 * and suggest concrete, sized actions.
 */
object Advisor {

    fun analyze(txs: List<Tx>, s: Settings, fmt: (Double) -> String, today: LocalDate = LocalDate.now()): Report {
        if (txs.isEmpty()) return Report(0.0, 0.0, 0.0, 0.0, 0.0, listOf(
            Tip("empty", Tone.IDEA, "Let's get to know your money",
                "Add what you earn and a few things you've spent on. After a week or so I'll start spotting patterns and tell you where you could keep more.",
                counts = false)
        ), false)

        val ym = YearMonth.from(today)
        val dom = today.dayOfMonth
        val dim = ym.lengthOfMonth()
        val pace = dim.toDouble() / dom
        val goal = s.goalPct / 100.0

        val cur = txs.inMonth(ym)
        val prevMonths = (1..3).map { ym.minusMonths(it.toLong()) }.filter { m -> txs.any { it.month == m } }
        val prev = prevMonths.map { txs.inMonth(it) }

        val incomeSamples = (prev.map { it.earned() } + cur.earned()).filter { it > 0 }
        val income = if (incomeSamples.isEmpty()) 0.0 else incomeSamples.average()

        // Typical monthly spend per category.
        val typical: Map<Category, Double> = Category.expenses.associateWith { c ->
            if (prev.isNotEmpty()) prev.map { m -> m.filter { it.category == c }.sumOf { it.amount } }.average()
            else cur.filter { it.category == c }.sumOf { it.amount } * pace
        }
        val expense = typical.values.sum()
        val needs = typical.filterKeys { it.kind == Kind.NEED }.values.sum()
        val wants = typical.filterKeys { it.kind == Kind.WANT }.values.sum()

        val tips = mutableListOf<Tip>()
        val flagged = mutableSetOf<Category>()

        // 1. Category running hot this month vs its usual.
        if (prev.size >= 1 && dom >= 7) {
            Category.expenses.forEach { c ->
                val usual = typical[c] ?: 0.0
                val proj = cur.filter { it.category == c }.sumOf { it.amount } * pace
                val over = proj - usual
                if (usual > 0 && proj > usual * 1.25 && over > max(expense * 0.02, 1.0)) {
                    flagged += c
                    val pct = ((proj / usual - 1) * 100).roundToLong()
                    tips += Tip("hot_${c.name}", Tone.WARN,
                        "${c.label} is running $pct% above usual",
                        "At this pace you'll spend ${fmt(proj)} on ${c.label.lowercase()} this month, against a usual ${fmt(usual)}. " +
                            "Pulling back to your normal level keeps about ${fmt(nice(over))} in your pocket.",
                        nice(over))
                }
            }
        }

        // 2. 50/30/20 — wants vs income.
        if (income > 0) {
            val wantsShare = wants / income
            val needsShare = needs / income
            if (wantsShare > 0.30) {
                val excess = wants - income * 0.30
                tips += Tip("wants", Tone.WARN,
                    "Wants take ${(wantsShare * 100).roundToLong()}% of your income",
                    "A healthy split is roughly 50% needs, 30% wants, 20% savings. Bringing wants halfway back toward 30% frees up around ${fmt(nice(excess / 2))} a month.",
                    nice(excess / 2))
            }
            if (needsShare > 0.55) {
                tips += Tip("needs", Tone.IDEA,
                    "Fixed costs are heavy at ${(needsShare * 100).roundToLong()}%",
                    "Needs above ~50% leave little room. Compare your phone, internet and insurance plans once a year — switching providers commonly trims 10% (≈${fmt(nice(needs * 0.05))}).",
                    nice(needs * 0.05))
            }
        }

        // 3. Recurring charges on wants.
        val since = today.minusMonths(4).toEpochDay()
        val recurring = txs.filter { !it.isIncome && it.day >= since && it.category.kind == Kind.WANT && it.note.isNotBlank() }
            .groupBy { it.note.trim().lowercase() }
            .mapNotNull { (_, list) ->
                val months = list.map { it.month }.distinct().size
                val med = list.map { it.amount }.sorted()[list.size / 2]
                val steady = list.all { kotlin.math.abs(it.amount - med) <= med * 0.15 }
                if (months >= 2 && steady && list.size <= months + 1) list.first().note.trim() to med else null
            }
        if (recurring.size >= 2) {
            val total = recurring.sumOf { it.second }
            val cheapest = recurring.minOf { it.second }
            val names = recurring.sortedByDescending { it.second }.take(4).joinToString(", ") { it.first }
            tips += Tip("subs", Tone.IDEA,
                "${recurring.size} subscriptions cost ${fmt(total)} a month",
                "I found repeating charges: $names. That's ${fmt(total * 12)} a year. Cancel the one you'd miss least — even the smallest saves ${fmt(cheapest)} every month.",
                nice(cheapest))
        }

        // 4. Lots of small purchases ("it's just a coffee").
        val last30 = today.minusDays(30).toEpochDay()
        val smallCap = max(expense * 0.006, 1.0)
        val small = txs.filter { !it.isIncome && it.day > last30 && it.category.kind == Kind.WANT && it.amount <= smallCap }
        if (small.size >= 8) {
            val sum = small.sumOf { it.amount }
            tips += Tip("small", Tone.IDEA,
                "${small.size} small buys added up to ${fmt(sum)}",
                "Over the last 30 days, purchases under ${fmt(smallCap)} each quietly became ${fmt(sum)}. Halving them — a coffee at home, one fewer snack run — saves about ${fmt(nice(sum * 0.5))}.",
                nice(sum * 0.5))
        }

        // 5. Weekend vs weekday spending on wants.
        val start60 = today.minusDays(59)
        val window = txs.filter { !it.isIncome && it.category.kind == Kind.WANT && !it.date.isBefore(start60) && !it.date.isAfter(today) }
        if (window.size >= 10) {
            var wkendDays = 0; var wkDays = 0
            var dd = start60
            while (!dd.isAfter(today)) { if (isWeekend(dd)) wkendDays++ else wkDays++; dd = dd.plusDays(1) }
            val wkend = window.filter { isWeekend(it.date) }.sumOf { it.amount } / max(1, wkendDays)
            val wk = window.filter { !isWeekend(it.date) }.sumOf { it.amount } / max(1, wkDays)
            if (wk > 0 && wkend > wk * 1.6) {
                val saving = (wkend - wk) * 4.3 * 0.5
                if (saving > expense * 0.01) tips += Tip("weekend", Tone.IDEA,
                    "Weekends cost you ${"%.1f".format(wkend / wk)}× more",
                    "You spend about ${fmt(wkend)} per weekend day on extras vs ${fmt(wk)} on weekdays. Make one weekend day a low-spend day (park, cook, friends at home) to save ~${fmt(nice(saving))} a month.",
                    nice(saving))
            }
        }

        // 6. Biggest want category — suggest a cap.
        typical.filterKeys { it.kind == Kind.WANT && it !in flagged }.maxByOrNull { it.value }?.let { (c, v) ->
            if (expense > 0 && v / expense > 0.12) {
                tips += Tip("cap_${c.name}", Tone.IDEA,
                    "Give ${c.label.lowercase()} a monthly cap",
                    "${c.label} is your biggest extra at ${fmt(v)} a month (${(v / expense * 100).roundToLong()}% of spending). A cap of ${fmt(nice(v * 0.8))} is barely noticeable and saves ${fmt(nice(v * 0.2))}.",
                    nice(v * 0.2))
            }
        }

        // 7. This month's pace vs income.
        if (income > 0 && dom >= 5 && dom < dim) {
            val spentSoFar = cur.spent()
            val projected = spentSoFar * pace
            val allowance = income * (1 - goal) - spentSoFar
            val daysLeft = dim - dom
            if (projected > income * (1 - goal)) {
                val perDay = max(0.0, allowance / daysLeft)
                tips += Tip("pace", Tone.WARN,
                    "On pace to spend ${fmt(projected)} this month",
                    if (allowance > 0) "To still save ${s.goalPct}%, keep spending under ${fmt(perDay)} a day for the next $daysLeft days."
                    else "You've already passed what you can spend while saving ${s.goalPct}%. Try to keep the last $daysLeft days to essentials only.",
                    counts = false)
            }
        }

        // 8. Savings rate summary.
        if (income > 0) {
            val rate = (income - expense) / income
            if (rate < goal) {
                val gap = (goal - rate) * income
                tips += Tip("rate", Tone.WARN,
                    "You're saving ${(rate * 100).roundToLong().coerceAtLeast(0)}% — goal is ${s.goalPct}%",
                    "Closing the gap means keeping ${fmt(nice(gap))} more each month. The ideas on this page add up to most of it.",
                    nice(gap), counts = false)
            } else {
                tips += Tip("rate", Tone.GOOD,
                    "You're saving ${(rate * 100).roundToLong()}% of income",
                    "That beats your ${s.goalPct}% goal. Move ${fmt(nice(income - expense))} to savings automatically on payday so it never sits in your spending account.",
                    counts = false)
            }
            val monthlySave = income - expense
            val fund = expense * 3
            if (monthlySave > 0) {
                val months = (fund / monthlySave).roundToLong().coerceAtLeast(1)
                tips += Tip("fund", Tone.GOOD,
                    "Build a 3-month safety net",
                    "Three months of expenses is ${fmt(nice(fund))}. Saving ${fmt(nice(monthlySave))} a month gets you there in about $months months — then start investing the surplus.",
                    counts = false)
            }
        } else {
            tips += Tip("noincome", Tone.IDEA, "Add your income",
                "Log your salary or other income so I can work out your savings rate and how much you can safely spend each day.",
                counts = false)
        }

        if (tips.none { it.tone == Tone.WARN } && income > 0)
            tips += Tip("calm", Tone.GOOD, "Nothing alarming this month",
                "Your spending looks steady. Keep logging — the more history I have, the sharper these suggestions get.", counts = false)

        val ordered = tips.sortedWith(compareBy<Tip> { it.tone.ordinal }.thenByDescending { it.saving })
        val potential = ordered.filter { it.counts }.sumOf { it.saving }
        return Report(income, expense, needs, wants, potential, ordered, true)
    }

    private fun isWeekend(d: LocalDate) = d.dayOfWeek == DayOfWeek.SATURDAY || d.dayOfWeek == DayOfWeek.SUNDAY

    /** Round to a friendly number. */
    fun nice(v: Double): Double {
        val step = when { v < 20 -> 1.0; v < 100 -> 5.0; v < 1000 -> 10.0; v < 10000 -> 50.0; else -> 100.0 }
        return (v / step).roundToLong() * step
    }
}
