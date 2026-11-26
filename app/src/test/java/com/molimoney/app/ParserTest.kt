package com.molimoney.app

import com.molimoney.app.data.Category
import com.molimoney.app.logic.NotifParser
import com.molimoney.app.logic.StatementImport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class ParserTest {
    private val today = LocalDate.of(2026, 11, 26)

    @Test fun indianBankWithdrawalDeposit() {
        val csv = """
            HDFC BANK Ltd.,,,,,,
            Statement of account,,,,,,
            Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
            01/11/26,SALARY NOV ACME CORP,0000,01/11/26,,"85,000.00","1,20,000.00"
            03/11/26,UPI-ZOMATO-zomato@hdfcbank-123,0000,03/11/26,450.00,,"1,19,550.00"
            05/11/26,UPI-BLINKIT-blinkit@axl,0000,05/11/26,"1,210.50",,"1,18,339.50"
            14/11/26,NETFLIX.COM,0000,14/11/26,649.00,,"1,17,690.50"
        """.trimIndent()
        val r = StatementImport.parse(csv, emptyList(), today).rows
        assertEquals(4, r.size)
        val sal = r.first { it.income }
        assertEquals(85000.0, sal.amount, 0.001); assertEquals(Category.Salary, sal.category)
        assertEquals(LocalDate.of(2026, 11, 1), sal.date)
        assertEquals(Category.Dining, r.first { it.desc.contains("ZOMATO") }.category)
        assertEquals(1210.5, r.first { it.desc.contains("BLINKIT") }.amount, 0.001)
        assertEquals(Category.Groceries, r.first { it.desc.contains("BLINKIT") }.category)
        assertEquals(Category.Subscriptions, r.first { it.desc.contains("NETFLIX") }.category)
    }

    @Test fun usSignedAmountIsoDates() {
        val csv = """
            Transaction Date,Description,Category,Amount
            2026-11-02,STARBUCKS #1234,Food,-5.75
            2026-11-03,UBER *TRIP,Travel,-18.20
            2026-11-03,UBER EATS,Food,-24.10
            2026-11-15,PAYROLL DEPOSIT,Income,3200.00
        """.trimIndent()
        val r = StatementImport.parse(csv, emptyList(), today).rows
        assertEquals(4, r.size)
        assertEquals(Category.Transport, r.first { it.desc.startsWith("UBER *") }.category)
        assertEquals(Category.Dining, r.first { it.desc == "UBER EATS" }.category)
        assertTrue(r.first { it.desc.startsWith("PAYROLL") }.income)
        assertEquals(5.75, r.first { it.desc.startsWith("STARBUCKS") }.amount, 0.001)
    }

    @Test fun europeanSemicolonDecimalComma() {
        val csv = "Datum;Buchungstext;Betrag\n24.11.2026;REWE Markt;-23,45\n25.11.2026;Miete;-1.200,00\n"
        // German headers: no known roles, falls back to content detection
        val r = StatementImport.parse(csv, emptyList(), today).rows
        assertEquals(2, r.size)
        assertEquals(1200.0, r.first { it.desc == "Miete" }.amount, 0.001)
    }

    @Test fun creditCardAllPositive() {
        val csv = "Date,Description,Amount\n11/20/2026,AMAZON MKTPLACE,42.99\n11/21/2026,SHELL OIL 123,38.00\n"
        val r = StatementImport.parse(csv, emptyList(), today).rows
        assertTrue(r.none { it.income })
        assertEquals(Category.Shopping, r.first { it.desc.startsWith("AMAZON") }.category)
        assertEquals(Category.Transport, r.first { it.desc.startsWith("SHELL") }.category)
    }

    @Test fun ofx() {
        val ofx = """
            <OFX><BANKTRANLIST>
            <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261120120000<TRNAMT>-12.50<NAME>SPOTIFY</STMTTRN>
            <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261101<TRNAMT>2500.00<NAME>EMPLOYER PAYROLL</STMTTRN>
            </BANKTRANLIST></OFX>
        """.trimIndent()
        val r = StatementImport.parse(ofx, emptyList(), today).rows
        assertEquals(2, r.size)
        assertEquals(Category.Subscriptions, r.first { !it.income }.category)
    }

    @Test fun duplicatesSkipped() {
        val csv = "Date,Description,Amount\n2026-11-02,A,-5\n2026-11-02,A,-5\n"
        val res = StatementImport.parse(csv, emptyList(), today)
        assertEquals(1, res.rows.size); assertEquals(1, res.duplicates)
    }

    @Test fun notifications() {
        val upi = NotifParser.parse("HDFC Bank", "Rs.250.00 debited from A/c XX1234 to VPA zomato@hdfcbank on 26-11-26. UPI Ref 1234")
        assertNotNull(upi); assertEquals(250.0, upi!!.amount, 0.001); assertTrue(!upi.income); assertEquals("Zomato", upi.merchant)

        val card = NotifParser.parse("Chase", "You made a $12.45 transaction with STARBUCKS on your card ending 1234")
        // "transaction with" has no debit word → only counted if phrased as a purchase
        val card2 = NotifParser.parse("Chase", "A purchase of $12.45 at STARBUCKS on your card ending 1234 was approved")
        assertNotNull(card2); assertEquals("Starbucks", card2!!.merchant)
        assertNull(card)

        val gpay = NotifParser.parse("Google Pay", "You paid ₹1,200 to Ramesh Kumar")
        assertEquals(1200.0, gpay!!.amount, 0.001); assertEquals("Ramesh Kumar", gpay.merchant)

        val credit = NotifParser.parse("SBI", "Your A/c XX99 is credited with INR 50,000.00 by SALARY ACME on 01-11")
        assertTrue(credit!!.income)

        assertNull(NotifParser.parse("Bank", "Your OTP for payment of Rs 500 is 123456"))
        assertNull(NotifParser.parse("Card", "Your bill of Rs 4,500 is due on 05-12"))
        assertNull(NotifParser.parse("Paytm", "Ravi is requesting Rs 300 from you"))
    }
}
