package com.molimoney.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.molimoney.app.data.Category
import com.molimoney.app.ui.theme.Moli
import com.molimoney.app.ui.theme.Type

val CardShape = RoundedCornerShape(22.dp)

@Composable
fun MCard(modifier: Modifier = Modifier, pad: Dp = 18.dp, content: @Composable ColumnScope.() -> Unit) {
    val c = Moli.c
    Column(
        modifier.clip(CardShape).background(c.card).border(1.dp, c.line, CardShape).padding(pad),
        content = content,
    )
}

@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier) =
    Text(text.uppercase(), style = Type.label, color = Moli.c.muted, modifier = modifier)

@Composable
fun Chip(text: String, selected: Boolean, modifier: Modifier = Modifier, dot: Color? = null, onClick: () -> Unit) {
    val c = Moli.c
    val bg by animateColorAsState(if (selected) c.ink else c.card, tween(260), label = "chipbg")
    val fg by animateColorAsState(if (selected) c.bg else c.ink, tween(260), label = "chipfg")
    androidx.compose.foundation.layout.Row(
        modifier.clip(CircleShape).background(bg).border(1.dp, if (selected) c.ink else c.line, CircleShape)
            .press(onClick).padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot != null) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
            androidx.compose.foundation.layout.Spacer(Modifier.size(8.dp))
        }
        Text(text, style = Type.small.copy(fontWeight = FontWeight.Medium), color = fg)
    }
}

@Composable
fun CatBadge(cat: Category, size: Dp = 38.dp) {
    val col = Color(cat.color)
    Box(Modifier.size(size).clip(CircleShape).background(col.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
        Text(cat.label.take(1), color = col, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.SemiBold,
            fontFamily = com.molimoney.app.ui.theme.Serif)
    }
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Moli.c
    val bg by animateColorAsState(if (enabled) c.clay else c.line, tween(250), label = "btn")
    Box(
        modifier.clip(RoundedCornerShape(16.dp)).background(bg).press { if (enabled) onClick() }.padding(vertical = 16.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = if (enabled) c.onClay else c.muted, style = Type.body.copy(fontWeight = FontWeight.SemiBold)) }
}

@Composable
fun GhostButton(text: String, modifier: Modifier = Modifier, color: Color = Moli.c.ink, onClick: () -> Unit) {
    val c = Moli.c
    Box(
        modifier.clip(RoundedCornerShape(16.dp)).border(1.dp, c.line, RoundedCornerShape(16.dp)).press(onClick).padding(vertical = 15.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = color, style = Type.body.copy(fontWeight = FontWeight.Medium)) }
}
