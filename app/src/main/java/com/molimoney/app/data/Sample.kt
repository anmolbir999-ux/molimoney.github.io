package com.molimoney.app.data

import java.time.DayOfWeek
import java.time.LocalDate
import kotlin.random.Random

/** Realistic-looking demo months so the charts and guide have something to say. */
object Sample {
    fun generate(currency: String, today: LocalDate = LocalDate.now()): List<Tx> {
        val k = when (currency) { "₹" -> 25.0; "¥" -> 150.0; else -> 1.0 }
        val r = Random(7)
        val out = mutableListOf<Tx>()
        var id = 1L
        fun add(d: LocalDate, amt: Double, c: Category, note: String) {
            if (!d.isAfter(today)) out += Tx(id++, Math.round(amt * k * 100) / 100.0, c, note, d.toEpochDay())
        }
        val start = today.withDayOfMonth(1).minusMonths(3)
        var d = start
        while (!d.isAfter(today)) {
            val thisMonth = d.month == today.month && d.year == today.year
            val weekend = d.dayOfWeek == DayOfWeek.SATURDAY || d.dayOfWeek == DayOfWeek.SUNDAY
            when (d.dayOfMonth) {
                1 -> add(d, 4200.0, Category.Salary, "Salary")
                2 -> add(d, 1350.0, Category.Housing, "Rent")
                3 -> add(d, 42.0, Category.Health, "Gym")
                5 -> { add(d, 95.0 + r.nextInt(40), Category.Bills, "Electricity"); add(d, 55.0, Category.Bills, "Internet") }
                8 -> add(d, 15.49, Category.Subscriptions, "Netflix")
                12 -> add(d, 39.0, Category.Bills, "Phone")
                14 -> add(d, 10.99, Category.Subscriptions, "Spotify")
                19 -> add(d, 12.99, Category.Subscriptions, "Cloud storage")
                21 -> add(d, 8.99, Category.Subscriptions, "Video app")
            }
            if (d.dayOfWeek == DayOfWeek.SUNDAY || d.dayOfWeek == DayOfWeek.WEDNESDAY)
                add(d, 45.0 + r.nextInt(55), Category.Groceries, if (r.nextBoolean()) "Supermarket" else "Groceries")
            if (!weekend && r.nextFloat() < 0.55f) add(d, 4.0 + r.nextInt(3), Category.Dining, "Coffee")
            val dineP = if (weekend) 0.75f else if (thisMonth) 0.35f else 0.18f
            if (r.nextFloat() < dineP) add(d, (if (weekend) 28.0 else 14.0) + r.nextInt(30), Category.Dining,
                listOf("Lunch", "Dinner out", "Takeaway", "Brunch").random(r))
            if (r.nextFloat() < 0.25f) add(d, 8.0 + r.nextInt(30), Category.Transport, if (r.nextBoolean()) "Ride" else "Fuel")
            if (r.nextFloat() < (if (weekend) 0.22f else 0.07f)) add(d, 20.0 + r.nextInt(110), Category.Shopping,
                listOf("Clothes", "Online order", "Home stuff", "Gadget").random(r))
            if (weekend && r.nextFloat() < 0.35f) add(d, 15.0 + r.nextInt(40), Category.Entertainment,
                listOf("Cinema", "Concert", "Games", "Bowling").random(r))
            if (d.dayOfMonth == 17 && r.nextBoolean()) add(d, 300.0 + r.nextInt(300), Category.Freelance, "Freelance gig")
            if (d.dayOfMonth == 24 && d.monthValue % 2 == 0) add(d, 180.0 + r.nextInt(120), Category.Travel, "Weekend trip")
            if (r.nextFloat() < 0.04f) add(d, 10.0 + r.nextInt(40), Category.Other, "Misc")
            d = d.plusDays(1)
        }
        return out
    }
}
