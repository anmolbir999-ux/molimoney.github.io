package com.molimoney.app.logic

import com.molimoney.app.data.Category
import com.molimoney.app.data.Settings
import com.molimoney.app.data.Tx
import com.molimoney.app.data.inMonth
import com.molimoney.app.data.spent
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.max
import kotlin.math.roundToLong

enum class Mood { HAPPY, CONCERNED, THINKING, WAVE }

data class DaySummary(
    val date: LocalDate,
    val spent: Double,
    val count: Int,
    val top: Pair<Category, Double>?,
    val biggest: Tx?,
    /** Today's everyday spending (excludes rent, bills, subscriptions). */
    val everyday: Double,
    /** Average everyday spending per day over the previous 30 days. */
    val usual: Double,
    val monthSpent: Double,
    val monthBudget: Double,
    val advice: String,
    val mood: Mood,
)

/** Builds the end-of-day "Moli Wrapped" recap. */
object Daily {
    private val fixed = setOf(Category.Housing, Category.Bills, Category.Subscriptions)

    fun summarize(txs: List<Tx>, s: Settings, fmt: (Double) -> String, date: LocalDate = LocalDate.now()): DaySummary {
        val day = date.toEpochDay()
        val today = txs.filter { it.day == day && !it.isIncome }
        val spent = today.sumOf { it.amount }
        val top = today.groupBy { it.category }.mapValues { e -> e.value.sumOf { it.amount } }.maxByOrNull { it.value }?.toPair()
        val biggest = today.maxByOrNull { it.amount }
        val everyday = today.filter { it.category !in fixed }.sumOf { it.amount }
        val window = txs.filter { !it.isIncome && it.category !in fixed && it.day in (day - 30) until day }
        val usual = window.sumOf { it.amount } / 30.0

        val ym = YearMonth.from(date)
        val monthSpent = txs.inMonth(ym).filter { it.day <= day }.spent()
        val income = Advisor.analyze(txs, s, fmt, date).income
        val budget = income * (1 - s.goalPct / 100.0)

        val (advice, mood) = when {
            today.isEmpty() -> (if (usual > 0) "A no-spend day! Your usual day costs about ${fmt(usual)}, so that's money kept. One more this week?"
                else "A quiet day with nothing spent. Those add up.") to Mood.HAPPY
            usual > 0 && everyday > usual * 1.3 -> {
                val pct = ((everyday / usual - 1) * 100).roundToLong()
                "Today ran $pct% above your usual day${top?.let { ", mostly on ${it.first.label.lowercase()}" } ?: ""}. " +
                    "Tomorrow, try to keep extras under ${fmt(Advisor.nice(usual * 0.8))}." to Mood.CONCERNED
            }
            usual > 0 && everyday < usual * 0.7 -> "Lighter than usual: ${fmt(usual - everyday)} below a normal day. That's how savings happen." to Mood.HAPPY
            else -> "Right around your usual day. Steady is good. Small wins, every day." to Mood.HAPPY
        }
        val extra = if (budget > 0 && date.dayOfMonth < ym.lengthOfMonth()) {
            val left = budget - monthSpent
            val days = ym.lengthOfMonth() - date.dayOfMonth
            if (left > 0) " You have ${fmt(left)} left for the month, about ${fmt(max(0.0, left / days))} a day."
            else " You're past this month's budget, so essentials only until payday."
        } else ""
        return DaySummary(date, spent, today.size, top, biggest, everyday, usual, monthSpent, budget, advice + extra, mood)
    }
}
