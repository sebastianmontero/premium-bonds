/**
 * Formats activity feed descriptions dynamically based on the active locale.
 */
export function formatLocalizedActivityDescription(
  description: string,
  locale: string
): string {
  if (locale !== "es" || !description) {
    return description;
  }

  let result = description;

  // Verb & phrase replacements
  result = result.replace(/\bDeposited\b/gi, "Depositó");
  result = result.replace(/\bSold\b/gi, "Vendido");
  result = result.replace(/\bWon\b/gi, "Ganó");
  result = result.replace(/\bAuto-reinvested\b/gi, "Auto-reinvertido");
  result = result.replace(
    /\bClaimed accumulated winnings of\b/gi,
    "Reclamó ganancias acumuladas de"
  );
  result = result.replace(
    /\bClaimed accumulated dust winnings of\b/gi,
    "Reclamó ganancias residuales acumuladas de"
  );
  result = result.replace(
    /\bClaimed settled redemption of\b/gi,
    "Reclamó redención liquidada de"
  );
  result = result.replace(
    /\breinvestment finalized\b/gi,
    "reinversión finalizada"
  );
  result = result.replace(/\bbatch reinvest\b/gi, "reinversión por lote");
  result = result.replace(/\bpartial reinvestment\b/gi, "reinversión parcial");

  // Prepositions & nouns
  result = result.replace(/\bto wallet\b/gi, "a la billetera");
  result = result.replace(/\bPending settle\b/gi, "Pendiente de liquidación");
  result = result.replace(/\bfrom\b/gi, "de");
  result = result.replace(/\bwinnings\b/gi, "ganancias");
  result = result.replace(/\bprior dust\b/gi, "residual anterior");
  result = result.replace(/\baccumulated dust\b/gi, "residual acumulado");
  result = result.replace(/\btickets\b/gi, "bonos");
  result = result.replace(/\bticket\b/gi, "bono");
  result = result.replace(/\bbonds\b/gi, "bonos");
  result = result.replace(/\bbond\b/gi, "bono");
  result = result.replace(/\bDraw #/gi, "Sorteo #");
  result = result.replace(/\bdust\b/gi, "residual");
  result = result.replace(/\bConsolation\b/gi, "Consolación");
  result = result.replace(/\bRunner-up\b/gi, "Segundo Lugar");
  result = result.replace(/\bJackpot\b/gi, "Premio Mayor");

  return result;
}
