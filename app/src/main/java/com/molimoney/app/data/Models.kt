package com.molimoney.app.data

import java.time.LocalDate
import java.time.YearMonth

enum class Kind { NEED, WANT, INCOME }

enum class Category(val label: String, val kind: Kind, val color: Long) {
    Housing("Housing", Kind.NEED, 0xFF8A93A6),
    Groceries("Groceries", Kind.NEED, 0xFF7C9A82),
    Bills("Bills", Kind.NEED, 0xFFB5A58C),
    Transport("Transport", Kind.NEED, 0xFF6F8FA8),
    Health("Health", Kind.NEED, 0xFF9BB3A0),
    Dining("Dining", Kind.WANT, 0xFFD9775A),
    Shopping("Shopping", Kind.WANT, 0xFFD4A55A),
    Entertainment("Fun", Kind.WANT, 0xFFA07A93),
    Subscriptions("Subscriptions", Kind.WANT, 0xFFC58B7A),
    Travel("Travel", Kind.WANT, 0xFF7FA3A0),
    Other("Other", Kind.WANT, 0xFFA8A296),
    Salary("Salary", Kind.INCOME, 0xFF7C9A82),
    Freelance("Side income", Kind.INCOME, 0xFF9BB3A0),
    Gift("Gift / other", Kind.INCOME, 0xFFB5A58C);

    val isIncome get() = kind == Kind.INCOME

    companion object {
        val expenses = entries.filter { !it.isIncome }
        val incomes = entries.filter { it.isIncome }
        fun of(name: String) = entries.firstOrNull { it.name == name } ?: Other
    }
}

data class Tx(
    val id: Long,
    val amount: Double,
    val category: Category,
    val note: String,
    val day: Long, // epoch day
    /** "m" manual, "i" imported from a statement, "a" auto-logged from a payment notification. */
    val source: String = "m",
) {
    val date: LocalDate get() = LocalDate.ofEpochDay(day)
    val month: YearMonth get() = YearMonth.from(date)
    val isIncome get() = category.isIncome
}

data class Settings(
    val name: String = "",
    val currency: String = "$",
    val goalPct: Int = 20,
    val onboarded: Boolean = false,
    val wrapped: Boolean = false,
    val wrappedHour: Int = 21,
    val autoTrack: Boolean = false,
    val askedNotif: Boolean = false,
    val hideSetupCard: Boolean = false,
)

fun List<Tx>.spent() = filter { !it.isIncome }.sumOf { it.amount }
fun List<Tx>.earned() = filter { it.isIncome }.sumOf { it.amount }
fun List<Tx>.inMonth(m: YearMonth) = filter { it.month == m }
