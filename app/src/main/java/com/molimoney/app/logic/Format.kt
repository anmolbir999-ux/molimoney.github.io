package com.molimoney.app.logic

import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs

fun money(v: Double, sym: String, decimals: Boolean = false): String {
    val nf = if (sym == "₹") NumberFormat.getNumberInstance(Locale("en", "IN")) else NumberFormat.getNumberInstance(Locale.US)
    val showDec = decimals && abs(v) % 1.0 > 0.004
    nf.maximumFractionDigits = if (showDec) 2 else 0
    nf.minimumFractionDigits = if (showDec) 2 else 0
    return (if (v < 0) "−" else "") + sym + nf.format(abs(v))
}
