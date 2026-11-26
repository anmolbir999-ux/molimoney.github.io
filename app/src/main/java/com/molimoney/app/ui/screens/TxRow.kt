package com.molimoney.app.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.molimoney.app.data.Tx
import com.molimoney.app.ui.components.CatBadge
import com.molimoney.app.ui.components.press
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type

val LocalCurrency = androidx.compose.runtime.staticCompositionLocalOf { "$" }

@Composable
fun TxRow(tx: Tx, fmt: (Double) -> String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = Moli.c
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).press(onClick).padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CatBadge(tx.category)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(tx.note.ifBlank { tx.category.label }, style = Type.body, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(tx.category.label, style = Type.small, color = c.muted)
        }
        Text(
            (if (tx.isIncome) "+" else "") + com.molimoney.app.logic.money(tx.amount, LocalCurrency.current, decimals = true),
            style = Type.body.copy(fontWeight = FontWeight.Medium),
            color = if (tx.isIncome) c.sage else c.ink,
        )
    }
}
