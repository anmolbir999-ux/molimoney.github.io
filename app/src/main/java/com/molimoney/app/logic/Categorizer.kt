package com.molimoney.app.logic

import com.molimoney.app.data.Category

/** Guesses a category from a merchant name or statement description. */
object Categorizer {
    private val rules: List<Pair<Regex, Category>> = listOf(
        Category.Salary to "salary, payroll, wages, stipend",
        Category.Freelance to "freelance, upwork, fiverr, invoice, consulting",
        Category.Gift to "refund, cashback, interest, dividend, reversal, gift",
        Category.Dining to "uber eats, zomato, swiggy, restaurant, cafe, coffee, starbucks, mcdonald, kfc, domino, pizza, burger, doordash, deliveroo, grubhub, dunkin, subway, chipotle, eatery, bakery, dhaba, biryani, food, kitchen, tea, chai",
        Category.Groceries to "grocery, groceries, supermarket, walmart, costco, aldi, lidl, tesco, kroger, bigbasket, blinkit, zepto, instamart, dmart, whole foods, trader joe, safeway, sainsbury, asda, morrisons, reliance fresh, more retail, spencer, market, mart",
        Category.Subscriptions to "netflix, spotify, prime video, hotstar, disney, youtube premium, youtube, icloud, apple.com, google one, google storage, hbo, adobe, chatgpt, openai, audible, patreon, subscription, membership",
        Category.Transport to "uber, ola, lyft, rapido, fuel, petrol, diesel, gas station, shell, chevron, exxon, metro, transit, parking, irctc, railway, train, bus, toll, fastag, taxi, cab",
        Category.Shopping to "amazon, flipkart, myntra, ebay, etsy, target, ikea, zara, h&m, nike, adidas, best buy, ajio, meesho, nykaa, decathlon, croma, mall, store, shop",
        Category.Bills to "electric, electricity, power, water, gas bill, internet, broadband, jio, airtel, vodafone, bsnl, verizon, at&t, t-mobile, comcast, xfinity, insurance, recharge, postpaid, prepaid, utility, bill",
        Category.Housing to "rent, mortgage, maintenance, landlord, housing, society, hoa",
        Category.Health to "pharmacy, chemist, apollo, hospital, clinic, doctor, gym, fitness, cult, medplus, netmeds, 1mg, cvs, walgreens, dental, lab, diagnostic",
        Category.Entertainment to "bookmyshow, cinema, pvr, inox, steam, playstation, xbox, nintendo, concert, ticketmaster, movie, theatre, theater, games",
        Category.Travel to "airline, airlines, indigo, air india, vistara, makemytrip, booking.com, airbnb, hotel, expedia, goibibo, cleartrip, flight, oyo, agoda, travel",
    ).flatMap { (cat, keys) ->
        keys.split(",").map { it.trim() }.filter { it.isNotEmpty() }.map { k ->
            Regex("(?<![a-z0-9])" + Regex.escape(k) + "(?![a-z0-9])", RegexOption.IGNORE_CASE) to cat
        }
    }.sortedByDescending { it.first.pattern.length } // longer, more specific keys first ("uber eats" before "uber")

    fun guess(text: String, income: Boolean): Category {
        val hit = rules.firstOrNull { (r, c) -> c.isIncome == income && r.containsMatchIn(text) }?.second
        return hit ?: if (income) Category.Gift else Category.Other
    }

    fun looksLikeIncome(text: String) =
        Regex("(?i)salary|payroll|refund|interest|dividend|credited|deposit|reversal|cashback").containsMatchIn(text)
}
