export type SupportedLocale = "en" | "es";
export type LocalizedString = Record<SupportedLocale, string>;

export interface DocCategory {
  slug: string;
  icon: string;
  title: LocalizedString;
  description: LocalizedString;
}

export interface DocArticle {
  slug: string;
  categorySlug: string;
  categoryTitle?: LocalizedString;
  title: LocalizedString;
  summary: LocalizedString;
  content: LocalizedString;
  tags: string[];
}

export interface ErrorLookupItem {
  code: string;
  numericCode?: number;
  hexCode?: string;
  name: string;
  summary?: LocalizedString;
  diagnosis: LocalizedString;
  solution: LocalizedString;
  category: "wallet" | "anchor" | "network" | "balance" | "crank" | "admin";
}

export const DOC_CATEGORIES: DocCategory[] = [
  {
    slug: "1-getting-started",
    icon: "🚀",
    title: {
      en: "Getting Started",
      es: "Primeros Pasos",
    },
    description: {
      en: "Learn how YieldBonds works, set up your Solana wallet, and acquire funds for network fees.",
      es: "Aprende cómo funciona YieldBonds, configura tu billetera Solana y obtén fondos para comisiones.",
    },
  },
  {
    slug: "2-protocol-mechanics",
    icon: "⚙️",
    title: {
      en: "Protocol Mechanics",
      es: "Mecánica del Protocolo",
    },
    description: {
      en: "Understand Huma Finance yield generation, bond allocation, VRF randomness, and risk disclosures.",
      es: "Entiende la generación de rendimiento con Huma Finance, asignación de bonos y aleatoriedad VRF.",
    },
  },
  {
    slug: "3-in-app-help",
    icon: "💡",
    title: {
      en: "In-App Guidance",
      es: "Guía en la Aplicación",
    },
    description: {
      en: "Explore our plain-language microcopy dictionary, transaction lifecycle states, and tooltip specs.",
      es: "Explora nuestro diccionario en lenguaje sencillo, estados de transacción y especificaciones de tooltips.",
    },
  },
  {
    slug: "4-troubleshooting",
    icon: "🛠️",
    title: {
      en: "Troubleshooting & Support",
      es: "Solución de Problemas y Soporte",
    },
    description: {
      en: "Self-service error lookup index, resolving stuck transactions, anti-phishing guidelines, and FAQs.",
      es: "Índice de búsqueda de errores, solución de transacciones atascadas, seguridad y preguntas frecuentes.",
    },
  },
];

export const DOC_ARTICLES: DocArticle[] = [
  // ==========================================
  // Category 1: Getting Started (4 Articles)
  // ==========================================
  {
    slug: "overview",
    categorySlug: "1-getting-started",
    categoryTitle: { en: "Getting Started", es: "Primeros Pasos" },
    title: {
      en: "Welcome to YieldBonds",
      es: "Bienvenido a YieldBonds",
    },
    summary: {
      en: "An introduction to YieldBonds — Solana's principal-protected prize-linked savings protocol.",
      es: "Una introducción a YieldBonds — el protocolo de ahorro con premios y protección de principal en Solana.",
    },
    tags: [
      "introduction",
      "overview",
      "basics",
      "no-loss",
      "savings",
      "principal",
    ],
    content: {
      en: `
# Welcome to YieldBonds

YieldBonds is a **prize-linked savings protocol** built on the high-speed Solana blockchain. It combines the financial security of traditional savings accounts with the upside of recurring prize draws — without risking a single cent of your principal deposit.

---

## How Does it Work?

Unlike a conventional lottery where ticket costs are lost forever, YieldBonds operates on a **Zero-Loss Savings Model**:

1. **Deposit USDC**: You deposit USDC into a YieldBonds pool. Every **1.00 USDC** deposited grants you **1 Prize Bond**.
2. **Earn Real-World Yield**: Your deposited principal is automatically routed to **Huma Finance** credit facilities to generate institutional real-world asset (RWA) credit yield.
3. **Win Prizes**: Total accumulated yield across the pool is pooled together and awarded to winning tickets during recurring draws powered by Switchboard Verifiable Random Functions (VRF).
4. **Auto-Compounding & Dust Winnings**: When you win, whole bond amounts auto-compound into new bonds immediately entering the next draw. Fractional dust ($< 1.00$ USDC) accumulates in your remaining winnings balance to unlock Bonus Bonds or for manual withdrawal.
5. **100% Principal Protection**: You can withdraw your full initial USDC deposit at any time.

---

## Key Benefits

> [!TIP]
> **Zero Risk to Principal**: Your initial deposit remains untouched in non-custodial smart contracts. Only the interest yield is distributed as prizes.

- **Non-Custodial**: You retain full cryptographic ownership of your deposited assets.
- **Provably Fair & Verifiable**: Winners are chosen through deterministic on-chain Switchboard VRF randomness with open mathematical proofs.
- **Continuous Compounding**: Prize winnings automatically reinvest as bonus tickets to continuously increase your future win probability.
- **No Fixed Lock-Ups**: Withdraw your deposits whenever you need liquidity.
      `,
      es: `
# Bienvenido a YieldBonds

YieldBonds es un **protocolo de ahorro con premios** creado en la blockchain de alta velocidad de Solana. Combina la seguridad financiera de una cuenta de ahorro tradicional con la emoción de sorteos periódicos, sin arriesgar ni un solo centavo de tu depósito inicial.

---

## ¿Cómo Funciona?

A diferencia de una lotería tradicional donde el costo del boleto se pierde para siempre, YieldBonds opera con un **Modelo de Ahorro Sin Pérdidas**:

1. **Deposita USDC**: Depositas USDC en un fondo de YieldBonds. Cada **1.00 USDC** depositado te otorga **1 Bono de Premio**.
2. **Genera Rendimiento Real**: Tu capital depositado se canaliza automáticamente a **Huma Finance** para generar rendimiento a través de créditos respaldados por activos del mundo real (RWA).
3. **Gana Premios**: Todo el rendimiento acumulado en el fondo se agrupa y se distribuye a boletos ganadores mediante sorteos periódicos impulsados por Funciones Aleatorias Verificables (VRF) de Switchboard.
4. **Auto-Capitalización y Saldo Remanente**: Al ganar, los montos de bonos enteros se auto-capitalizan en nuevos bonos que entran al siguiente sorteo. Las fracciones ($< 1.00$ USDC) se acumulan en tu saldo de ganancias remanentes para desbloquear Bonos de Bonificación o para retiro manual.
5. **Protección del 100% del Principal**: Puedes retirar todo tu depósito inicial de USDC en cualquier momento.

---

## Beneficios Clave

> [!TIP]
> **Cero Riesgo para tu Capital**: Tu depósito inicial permanece intacto en contratos inteligentes no custodiales. Solo los intereses generados se entregan como premios.

- **No Custodial**: Mantienes la propiedad criptográfica total de tus activos depositados.
- **Demostrablemente Justo y Verificable**: Los ganadores se eligen mediante aleatoriedad determinista Switchboard VRF con pruebas matemáticas públicas.
- **Interés Compuesto Continuo**: Las ganancias se reinvierten automáticamente como bonos para aumentar tus probabilidades futuras.
- **Sin Bloqueos Fijos**: Retira tus depósitos cuando necesites liquidez.
      `,
    },
  },
  {
    slug: "wallet-setup",
    categorySlug: "1-getting-started",
    categoryTitle: { en: "Getting Started", es: "Primeros Pasos" },
    title: {
      en: "Setting Up a Solana Wallet",
      es: "Configuración de una Billetera Solana",
    },
    summary: {
      en: "Step-by-step guide to installing and securing Phantom, Solflare, or Backpack wallets.",
      es: "Guía paso a paso para instalar y asegurar billeteras como Phantom, Solflare o Backpack.",
    },
    tags: ["wallet", "phantom", "solflare", "setup", "security", "seed phrase"],
    content: {
      en: `
# Setting Up a Solana Wallet

To interact with YieldBonds, you need a Web3 wallet compatible with the Solana network. We recommend using official browser extensions or mobile apps such as **Phantom**, **Solflare**, or **Backpack**.

---

## Recommended Wallets

| Wallet | Supported Platforms | Features |
| :--- | :--- | :--- |
| **Phantom** | Browser Extension, iOS, Android | Intuitive interface, high security, built-in swap and activity feed. |
| **Solflare** | Browser Extension, iOS, Android | Advanced staking features, native Ledger hardware wallet support. |
| **Backpack** | Browser Extension, iOS, Android | Multi-chain support, xNFT capabilities, developer tools. |

---

## Step-by-Step Installation Guide

1. **Download the Extension**:
   Visit the official website of your chosen wallet (e.g. [phantom.app](https://phantom.app) or [solflare.com](https://solflare.com)). Never download wallet extensions from unverified third-party links or ads.

2. **Create a New Wallet**:
   Select **"Create New Wallet"** when prompted.

3. **Secure Your Secret Recovery Phrase (Seed Phrase)**:
   You will be shown a 12-word or 24-word Secret Recovery Phrase.

> [!CAUTION]
> **CRITICAL SECURITY WARNING**:
> - Write down your recovery phrase on physical paper and store it offline in a secure, fireproof location.
> - **NEVER** store your seed phrase in unencrypted digital notes, screenshots, or cloud storage.
> - **NEVER** share your recovery phrase or private key with anyone. YieldBonds team members will NEVER ask for your seed phrase.
> - Anyone with access to your recovery phrase can drain all assets stored in your wallet.

4. **Set a Strong Password**:
   Configure an unlock password for daily use on your browser extension.
      `,
      es: `
# Configuración de una Billetera Solana

Para interactuar con YieldBonds, necesitas una billetera Web3 compatible con la red Solana. Recomendamos usar extensiones de navegador u aplicaciones móviles oficiales como **Phantom**, **Solflare** o **Backpack**.

---

## Billeteras Recomendadas

| Billetera | Plataformas Soportadas | Características |
| :--- | :--- | :--- |
| **Phantom** | Extensión de Navegador, iOS, Android | Interfaz intuitiva, alta seguridad, intercambios y registro de actividad integrados. |
| **Solflare** | Extensión de Navegador, iOS, Android | Funciones avanzadas de staking, soporte nativo para hardware Ledger. |
| **Backpack** | Extensión de Navegador, iOS, Android | Soporte multi-cadena, capacidades xNFT y herramientas avanzadas. |

---

## Guía Paso a Paso de Instalación

1. **Descarga la Extensión**:
   Visita el sitio web oficial de la billetera elegida (ej. [phantom.app](https://phantom.app) o [solflare.com](https://solflare.com)). Nunca descargues extensiones de enlaces no verificados o anuncios.

2. **Crea una Nueva Billetera**:
   Selecciona **"Crear Nueva Billetera"** cuando se te solicite.

3. **Asegura tu Frase Secreta de Recuperación**:
   Se te mostrará una Frase Secreta de Recuperación de 12 o 24 palabras.

> [!CAUTION]
> **ADVERTENCIA DE SEGURIDAD CRÍTICA**:
> - Escribe tu frase de recuperación en papel físico y guárdala fuera de línea en un lugar seguro.
> - **NUNCA** guardes tu frase en notas digitales no cifradas, capturas de pantalla o almacenamiento en la nube.
> - **NUNCA** compartas tu frase de recuperación ni tus claves privadas con nadie. El equipo de YieldBonds NUNCA te pedirá tu frase.
> - Cualquier persona con acceso a tu frase de recuperación puede transferir todos los activos de tu billetera.

4. **Establece una Contraseña Segura**:
   Configura una contraseña de desbloqueo para el uso diario en tu navegador.
      `,
    },
  },
  {
    slug: "acquiring-sol-usdc",
    categorySlug: "1-getting-started",
    categoryTitle: { en: "Getting Started", es: "Primeros Pasos" },
    title: {
      en: "Acquiring SOL & USDC",
      es: "Obtención de SOL y USDC",
    },
    summary: {
      en: "How to get SOL for network fees and USDC for purchasing prize bonds.",
      es: "Cómo obtener SOL para comisiones de red y USDC para adquirir bonos de depósito.",
    },
    tags: ["sol", "usdc", "network fee", "gas", "rent", "deposit"],
    content: {
      en: `
# Acquiring SOL & USDC

To participate in YieldBonds, your wallet needs two assets:
1. **SOL**: Solana's native cryptocurrency used to pay minimal **Network Fees** ($< 0.005$ USD per transaction) and refundable account storage rent.
2. **USDC**: A 1:1 USD-pegged stablecoin used to purchase bonds and earn yields.

---

## 1. Getting SOL for Network Fees & Storage Rent

Every blockchain operation (depositing, withdrawing, claiming prizes) requires a tiny amount of SOL to execute. When creating your initial User Entry or Winnings account on-chain, Solana requires a small one-time refundable rent exemption deposit ($\approx 0.002$–$0.004$ SOL) that is returned when accounts are closed.

- **Centralized Exchanges**: Purchase SOL on platforms like Coinbase, Kraken, Binance, or Phantom Pay, and withdraw it to your Solana account address.
- **Minimum Recommended SOL**: Maintain at least **0.05 SOL** in your wallet to cover account rent allocation and network execution fees smoothly.

---

## 2. Getting USDC for Deposits

YieldBonds operates primarily using **USDC on Solana** (SPL Token).

- **Swap Inside Wallet**: If you hold SOL or USDT, you can use Phantom or Solflare's built-in swap feature to convert it to USDC.
- **Decentralized Exchanges (DEXs)**: Use Jupiter Aggregator ([jup.ag](https://jup.ag)) to swap tokens with ultra-low slippage and best route discovery.

> [!NOTE]
> Ensure you hold **USDC on Solana (SPL Token)** with mint \`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\`, and not an Ethereum ERC-20 or wrapped version.
      `,
      es: `
# Obtención de SOL y USDC

Para participar en YieldBonds, tu billetera necesita dos activos:
1. **SOL**: La criptomoneda nativa de Solana utilizada para pagar **Comisiones de Red** ($< 0.005$ USD por transacción) y la renta reembolsable de almacenamiento de cuentas.
2. **USDC**: Una moneda estable vinculada 1:1 al dólar utilizada para comprar bonos y generar rendimientos.

---

## 1. Obtener SOL para Comisiones de Red y Renta

Cada operación en la blockchain (depositar, retirar, reclamar premios) requiere una pequeña cantidad de SOL. Al crear tus cuentas de registro o de ganancias en cadena, Solana requiere un depósito reembolsable único de renta ($\approx 0.002$–$0.004$ SOL) que se recupera si se cierran las cuentas.

- **Intercambios Centralizados**: Compra SOL en plataformas como Coinbase, Kraken o Binance, y retíralo a tu dirección de Solana.
- **Mínimo Recomendado**: Mantén al menos **0.05 SOL** en tu billetera para cubrir la renta de almacenamiento y las comisiones sin interrupciones.

---

## 2. Obtener USDC para Depósitos

YieldBonds opera principalmente con **USDC en Solana** (Token SPL).

- **Intercambio en Billetera**: Si tienes SOL o USDT, puedes usar la función de intercambio integrada de Phantom o Solflare para convertirlo a USDC.
- **Intercambios Descentralizados (DEX)**: Usa Jupiter Aggregator ([jup.ag](https://jup.ag)) para cambiar tokens con mínimo deslizamiento y el mejor enrutamiento.

> [!NOTE]
> Asegúrate de tener **USDC en Solana (Token SPL)** con el mint \`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\`, y no versiones ERC-20 de Ethereum o tokens envueltos.
      `,
    },
  },
  {
    slug: "connecting-safety",
    categorySlug: "1-getting-started",
    categoryTitle: { en: "Getting Started", es: "Primeros Pasos" },
    title: {
      en: "Wallet Connection & Security",
      es: "Conexión de Billetera y Seguridad",
    },
    summary: {
      en: "Understanding read-only connection vs transaction authorization safety.",
      es: "Comprende la diferencia entre conexión de lectura y autorización de transacciones.",
    },
    tags: ["security", "connection", "signing", "authorization", "phishing"],
    content: {
      en: `
# Wallet Connection & Safety Guidelines

When using Web3 dApps, understanding what permissions you grant to websites is essential for protecting your funds.

---

## Connecting Your Wallet (Read-Only Access)

When you click **[Connect Wallet]** on YieldBonds:
- You are ONLY granting the website permission to view your public wallet address and SPL token balances.
- Connecting **CANNOT** spend funds, move tokens, or sign transactions without your explicit approval on each individual action.

---

## Approving Transactions (Explicit Authorization)

When you deposit, withdraw, or claim prize winnings:
- Your connected wallet extension will pop up a window asking for your explicit confirmation.
- **Always inspect the transaction details**: Verify the destination program, network fee, and token amounts before clicking "Approve".
- YieldBonds utilizes the modern Solana Wallet Standard with clean instruction simulations.

> [!WARNING]
> **Phishing Prevention Checklist**:
> 1. Check the browser URL bar: Ensure you are on the official YieldBonds domain (\`https://yieldbonds.io\`).
> 2. Bookmark the official app URL. Never click links from unverified social media direct messages or Discord bots.
> 3. YieldBonds will NEVER ask for seed phrases, private keys, or blind transfers.
      `,
      es: `
# Conexión de Billetera y Guías de Seguridad

Al usar aplicaciones Web3, comprender qué permisos otorgas a los sitios web es esencial para proteger tus fondos.

---

## Conectar tu Billetera (Acceso de Solo Lectura)

Cuando haces clic en **[Conectar Billetera]** en YieldBonds:
- SOLO estás otorgando al sitio permiso para consultar tu dirección pública y saldos de tokens SPL.
- Conectarte **NO PUEDE** gastar fondos, transferir tokens ni firmar transacciones sin tu aprobación explícita en cada acción individual.

---

## Aprobar Transacciones (Autorización Explícita)

Cuando depositas, retiras o reclamas ganancias:
- La extensión de tu billetera mostrará una ventana solicitando tu confirmación explícita.
- **Verifica siempre los detalles**: Revisa el programa de destino, comisiones y montos de tokens antes de hacer clic en "Aprobar".
- YieldBonds utiliza el estándar moderno Solana Wallet Standard con simulaciones limpias de instrucciones.

> [!WARNING]
> **Lista de Verificación Anti-Phishing**:
> 1. Verifica la barra de direcciones del navegador: Asegúrate de estar en el dominio oficial de YieldBonds (\`https://yieldbonds.io\`).
> 2. Guarda el sitio oficial en tus marcadores. Nunca hagas clic en enlaces de mensajes directos en redes sociales o bots de Discord.
> 3. YieldBonds NUNCA solicitará frases semilla, claves privadas ni transferencias ciegas.
      `,
    },
  },

  // ==========================================
  // Category 2: Protocol Mechanics (5 Articles)
  // ==========================================
  {
    slug: "how-it-works",
    categorySlug: "2-protocol-mechanics",
    categoryTitle: { en: "Protocol Mechanics", es: "Mecánica del Protocolo" },
    title: {
      en: "No-Loss Yield Savings Flow",
      es: "Flujo de Ahorro con Rendimiento Sin Pérdidas",
    },
    summary: {
      en: "Detailed architecture of how USDC deposits generate institutional yield through Huma Finance.",
      es: "Arquitectura detallada de cómo los depósitos de USDC generan rendimiento institucional mediante Huma Finance.",
    },
    tags: [
      "architecture",
      "huma",
      "yield",
      "pool",
      "vault",
      "no-loss",
      "compounding",
    ],
    content: {
      en: `
# No-Loss Yield Savings Architecture

YieldBonds operates a non-custodial, automated pool system built using the Anchor smart contract framework on Solana.

---

## Yield Generation via Huma Finance

All user USDC deposits are aggregated in the protocol vault account and routed into **Huma Finance** credit pools via Cross-Program Invocations (CPI). Huma Finance generates competitive institutional yield backed by real-world assets (RWA) and trade receivables.

\`\`\`
┌──────────────────┐      1:1 Deposit      ┌──────────────────┐
│  User USDC Wallet│ ────────────────────► │ YieldBonds Vault │
└──────────────────┘                       └────────┬─────────┘
                                                    │
                                                    ▼ (Deploys Capital via CPI)
┌──────────────────┐   Distributes Yield   ┌──────────────────┐
│ Prize Pool Pot   │ ◄──────────────────── │   Huma Finance   │
└────────┬─────────┘                       │   Credit Pool    │
         │                                 └──────────────────┘
         ▼ (Switchboard VRF Draw)
┌──────────────────┐
│  Weekly Winners  │ ──► [Auto-Reinvest into Whole Bonds] + [Fractional Dust Balance]
└──────────────────┘
\`\`\`

---

## Zero-Loss Principal Guarantee

Because only the *yield interest* earned from Huma Finance is harvested and placed into the prize pot, your underlying deposited principal is never spent or exposed to prize draw risk. When you withdraw, you receive 100% of your initial USDC back.

---

## Auto-Compounding & Bonus Bond Unlocking

When a prize is won:
- Whole bond values auto-compound immediately into new active bonds, increasing the winner's statistical probability for subsequent weekly draws.
- Fractional winnings ($< 1.00$ USDC) accumulate safely in \`unclaimed_non_reinvested_winnings\`.
- As prior remaining dust aggregates with new winnings, crossing a whole dollar threshold automatically mints additional **Bonus Bonds**.
      `,
      es: `
# Arquitectura de Ahorro con Rendimiento Sin Pérdidas

YieldBonds opera un sistema de fondos automatizado y no custodial desarrollado con el framework Anchor en Solana.

---

## Generación de Rendimiento con Huma Finance

Todos los depósitos de USDC se agrupan en la cuenta del vault del protocolo y se canalizan a los fondos de crédito de **Huma Finance** mediante Invocaciones Entre Programas (CPI). Huma Finance genera un rendimiento competitivo respaldado por activos del mundo real (RWA) y cuentas por cobrar comerciales.

\`\`\`
┌──────────────────┐     Depósito 1:1      ┌──────────────────┐
│ Billetera USDC   │ ────────────────────► │ Vault YieldBonds │
└──────────────────┘                       └────────┬─────────┘
                                                    │
                                                    ▼ (Despliega Capital vía CPI)
┌──────────────────┐ Distribuye Rendimiento ┌──────────────────┐
│ Fondo de Premios │ ◄───────────────────── │   Huma Finance   │
└────────┬─────────┘                        │ Fondo de Crédito │
         │                                  └──────────────────┘
         ▼ (Sorteo Switchboard VRF)
┌──────────────────┐
│ Ganadores Semanal│ ──► [Auto-Reinversión en Bonos Enteros] + [Saldo Fraccionario]
└──────────────────┘
\`\`\`

---

## Garantía de Principal Sin Pérdidas

Dado que solo los *intereses generados* por Huma Finance se cosechan y se colocan en el bote de premios, tu capital inicial depositado nunca se gasta ni se expone a riesgos de sorteo. Al retirar, recibes el 100% de tu USDC depositado.

---

## Auto-Capitalización y Bonos de Bonificación

Al ganar un premio:
- Los montos enteros de bonos se reinvierten automáticamente en nuevos bonos activos, aumentando la probabilidad del ganador en los sorteos siguientes.
- Las ganancias fraccionarias ($< 1.00$ USDC) se acumulan de forma segura en \`unclaimed_non_reinvested_winnings\`.
- Al agregarse el saldo remanente anterior con nuevas ganancias y superar el umbral de 1 dólar, se desbloquean automáticamente **Bonos de Bonificación**.
      `,
    },
  },
  {
    slug: "deposits-and-tickets",
    categorySlug: "2-protocol-mechanics",
    categoryTitle: { en: "Protocol Mechanics", es: "Mecánica del Protocolo" },
    title: {
      en: "Bonds & Deposit Mechanics",
      es: "Mecánica de Bonos y Depósitos",
    },
    summary: {
      en: "1 USDC = 1 Bond ratio, active vs pending bonds, dust aggregation, and withdrawals.",
      es: "Relación 1 USDC = 1 Bono, bonos activos vs pendientes, agregación de polvo y retiros.",
    },
    tags: [
      "bonds",
      "deposit",
      "withdraw",
      "usdc",
      "registry",
      "dust",
      "bonus bonds",
    ],
    content: {
      en: `
# Bonds & Deposit Mechanics

YieldBonds uses an ultra-efficient, zero-copy bond registry model to track prize draw eligibility on Solana.

---

## 1 USDC = 1 Prize Bond

- For every **1.00 USDC** you deposit into a pool, you receive **1 Prize Bond**.
- **Active vs. Pending Bonds**: Deposits made during an ongoing stake cycle are initially marked as *Pending Bonds*. At the next cycle harvest snapshot, all pending bonds transition into *Active Bonds* and become eligible for draws indefinitely.
- The more bonds you hold, the higher your statistical probability of winning weekly draws.

---

## Ticket Registry & Dynamic Reallocation

Bonds are recorded in your account's zero-copy \`TicketRegistry\` PDA. YieldBonds employs an optimized 104-byte header structure with raw byte entry access that dynamically resizes in 10 KB increments, avoiding large upfront rent costs while supporting millions of active tickets.

---

## Remaining Winnings (Dust Balance) & Bonus Bonds

Because prize allocations can result in fractional USDC amounts (e.g. winning $14.35 USDC):
1. **14 Whole Bonds** are auto-minted and added to your active balance.
2. **0.35 USDC Dust** is credited to your \`unclaimed_non_reinvested_winnings\` balance.
3. If you subsequently win another prize with $0.70 USDC dust, the combined $1.05 USDC balance automatically mints **1 Bonus Bond** with $0.05 USDC remaining.

> [!NOTE]
> **Graceful Dust Routing**: If a pool is in \`Closed\` status or the registry reaches capacity, 100% of prize winnings route to your dust balance for instant manual withdrawal.

---

## Withdrawals & Liquidity Paths

You can withdraw your USDC deposits at any time:
1. **Instant Vault Cash**: When idle liquidity is available in the protocol vault, withdrawals execute immediately.
2. **Queued Huma Redemptions**: If funds are deployed in Huma credit pools, an asynchronous \`PendingRedemption\` request is registered. Once Huma settles liquidity, you claim your USDC directly via the dashboard.
      `,
      es: `
# Mecánica de Bonos y Depósitos

YieldBonds utiliza un registro de bonos zero-copy altamente eficiente para gestionar la elegibilidad en los sorteos en Solana.

---

## 1 USDC = 1 Bono de Premio

- Por cada **1.00 USDC** depositado en el fondo, recibes **1 Bono de Premio**.
- **Bonos Activos vs. Pendientes**: Los depósitos realizados durante un ciclo en curso se marcan inicialmente como *Bonos Pendientes*. En la captura del siguiente ciclo, todos los bonos pendientes pasan a ser *Bonos Activos* y participan indefinidamente.
- Cuantos más bonos poseas, mayor será tu probabilidad estadística de ganar los sorteos semanales.

---

## Registro de Bonos y Reasignación Dinámica

Los bonos se registran en la cuenta PDA zero-copy \`TicketRegistry\`. YieldBonds utiliza una cabecera optimizada de 104 bytes con acceso directo a bytes que se redimensiona dinámicamente en bloques de 10 KB, evitando costos elevados de renta inicial mientras soporta millones de boletos activos.

---

## Ganancias Remanentes (Saldo Residual) y Bonos de Bonificación

Dado que las asignaciones de premios pueden incluir montos fraccionarios (ej. ganar $14.35 USDC):
1. **14 Bonos Enteros** se emiten automáticamente y se agregan a tu saldo activo.
2. **0.35 USDC de Saldo Remanente** se acreditan a tu saldo \`unclaimed_non_reinvested_winnings\`.
3. Si posteriormente ganas otro premio con $0.70 USDC remanentes, el saldo combinado de $1.05 USDC emite automáticamente **1 Bono de Bonificación**, quedando $0.05 USDC remanentes.

> [!NOTE]
> **Enrutamiento Residual Seguro**: Si un fondo está en estado \`Closed\` o el registro alcanza su capacidad máxima, el 100% del premio se destina al saldo remanente para retiro manual instantáneo.

---

## Retiros y Rutas de Liquidez

Puedes retirar tus depósitos de USDC en cualquier momento:
1. **Liquidez Instantánea en Vault**: Cuando hay liquidez disponible en el vault, los retiros se ejecutan de inmediato.
2. **Redenciones en Cola de Huma**: Si los fondos están invertidos en Huma, se registra una solicitud asíncrona \`PendingRedemption\`. Una vez que Huma liquida los fondos, reclamas tu USDC directamente en el panel.
      `,
    },
  },
  {
    slug: "prize-draws-vrf",
    categorySlug: "2-protocol-mechanics",
    categoryTitle: { en: "Protocol Mechanics", es: "Mecánica del Protocolo" },
    title: {
      en: "Prize Draws & VRF Randomness",
      es: "Sorteos de Premios y Aleatoriedad VRF",
    },
    summary: {
      en: "6-stage draw lifecycle, 44-byte SHA-256 derivation formula, and settlement timelocks.",
      es: "Ciclo de sorteo de 6 etapas, fórmula de derivación SHA-256 de 44 bytes y bloqueos de liquidación.",
    },
    tags: [
      "vrf",
      "randomness",
      "switchboard",
      "draw",
      "winners",
      "timelock",
      "provable fairness",
    ],
    content: {
      en: `
# Prize Draws & Verifiable Randomness (VRF)

Transparency and cryptographic fairness are foundational to YieldBonds. Prize draw winners are selected using **Switchboard On-Demand Verifiable Random Functions (VRF)** with deterministic on-chain derivations.

---

## The 6-Stage Draw Cycle Lifecycle

\`\`\`
1. AWAITING YIELD ──► 2. HARVEST FREEZE ──► 3. VRF RESOLUTION ──► 4. WINNER DERIVATION ──► 5. SETTLEMENT TIMELOCK ──► 6. REINVESTMENT CRANK
\`\`\`

1. **Awaiting Yield**: Principal earns interest throughout the stake cycle duration (e.g. 168 hours / 7 days).
2. **Harvest Freeze (\`harvest_yield_and_commit\`)**: Yield is calculated from Huma $PST shares, prize pot is committed, ticket registry is snapshotted, and Switchboard VRF randomness is requested.
3. **VRF Resolution**: Switchboard decentralized oracle nodes resolve the 32-byte verifiable randomness seed on-chain.
4. **Winner Derivation (\`reveal_and_pick_winners\`)**: The smart contract deterministically computes winning ticket indexes using the 44-byte cryptographic hash formula and records winners in the \`PayoutRegistry\`.
5. **Settlement Timelock**: A mandatory safety pause (default: 300 seconds / 5 minutes) begins, allowing public verification and preventing front-running exploits.
6. **Reinvestment Crank (\`reinvest_winnings\`)**: Following timelock expiration, the crank compounds whole bonds into active registries and credits dust balances.

---

## Provable Fairness: The 44-Byte Cryptographic Formula

Winner derivation is executed natively in \`anchor/programs/anchor/src/utils.rs\`:

$$\\text{Buffer}_{44\\text{B}} = \\text{RandomnessSeed}_{32\\text{B}} \\parallel \\text{u32(TierIndex)}_{\\text{LE}} \\parallel \\text{u32(WinnerSlot)}_{\\text{LE}} \\parallel \\text{u32(CycleID)}_{\\text{LE}}$$
$$\\text{Hash}_{32\\text{B}} = \\text{SHA-256}(\\text{Buffer}_{44\\text{B}})$$
$$\\text{WinningTicketIndex} = (\\text{Hash}[0..8] \\text{ as u64 LE}) \\pmod{\\text{TotalLockedTickets}_{\\text{u32}}}$$

Anyone can independently verify draw results using our in-app **Provable Fairness Verifier** or open-source scripts.

---

## Operator Cranks & Recovery Mechanisms

- **\`prepare_draw\`**: Pre-computes cumulative ticket sums and merges lazy deposits in large registries to stay well within Solana's 200,000 Compute Unit (CU) budget per transaction.
- **\`crank_rebind_expired_randomness\`**: If an oracle request is stalled for $> 1,000$ slots ($\approx 6.6$ minutes), permissioned crank bots rebind fresh randomness without requiring admin intervention.
- **Draw Statuses**: \`AwaitingYield\`, \`AwaitingRandomness\`, \`Complete\`, \`Skipped\` (rollover), \`Voided\`, \`ForceUnlocked\`, \`HaltedInsolvent\`, \`HaltedYieldSpike\`.
      `,
      es: `
# Sorteos de Premios y Aleatoriedad Verificable (VRF)

La transparencia y la equidad criptográfica son fundamentales en YieldBonds. Los ganadores se seleccionan mediante **Funciones Aleatorias Verificables (VRF) Switchboard On-Demand** con derivaciones deterministas en cadena.

---

## El Ciclo de Vida del Sorteo de 6 Etapas

\`\`\`
1. ESPERANDO RENDIMIENTO ──► 2. CONGELACIÓN DE COSECHA ──► 3. RESOLUCIÓN VRF ──► 4. DERIVACIÓN DE GANADORES ──► 5. BLOQUEO DE LIQUIDACIÓN ──► 6. CRANK DE REINVERSIÓN
\`\`\`

1. **Esperando Rendimiento**: El capital genera intereses durante la duración del ciclo (ej. 168 horas / 7 días).
2. **Congelación de Cosecha (\`harvest_yield_and_commit\`)**: Se calcula el rendimiento de las acciones $PST de Huma, se fija el bote de premios, se toma la captura del registro y se solicita la semilla VRF.
3. **Resolución VRF**: Los nodos del oráculo Switchboard resuelven la semilla aleatoria de 32 bytes en la blockchain.
4. **Derivación de Ganadores (\`reveal_and_pick_winners\`)**: El contrato inteligente calcula deterministamente los boletos ganadores mediante la fórmula criptográfica de 44 bytes y los guarda en el \`PayoutRegistry\`.
5. **Bloqueo Temporal de Liquidación**: Se activa una pausa de seguridad obligatoria (defecto: 300 segundos / 5 minutos) que permite la auditoría pública y evita exploits de front-running.
6. **Crank de Reinversión (\`reinvest_winnings\`)**: Tras expirar el bloqueo, el crank reinvierte los bonos enteros y acredita los saldos remanentes.

---

## Equidad Demostrable: La Fórmula Criptográfica de 44 Bytes

La selección del ganador se realiza en \`anchor/programs/anchor/src/utils.rs\`:

$$\\text{Buffer}_{44\\text{B}} = \\text{RandomnessSeed}_{32\\text{B}} \\parallel \\text{u32(TierIndex)}_{\\text{LE}} \\parallel \\text{u32(WinnerSlot)}_{\\text{LE}} \\parallel \\text{u32(CycleID)}_{\\text{LE}}$$
$$\\text{Hash}_{32\\text{B}} = \\text{SHA-256}(\\text{Buffer}_{44\\text{B}})$$
$$\\text{WinningTicketIndex} = (\\text{Hash}[0..8] \\text{ como u64 LE}) \\pmod{\\text{TotalLockedTickets}_{\\text{u32}}}$$

Cualquier persona puede verificar los resultados de los sorteos con nuestra herramienta **Verificador de Equidad Demostrable** o scripts de código abierto.

---

## Cranks de Operación y Mecanismos de Recuperación

- **\`prepare_draw\`**: Precalcula sumas acumuladas de boletos en registros grandes para mantenerse dentro del límite de 200,000 Unidades de Cómputo (CU) por transacción en Solana.
- **\`crank_rebind_expired_randomness\`**: Si una solicitud del oráculo queda inactiva por $> 1,000$ slots ($\approx 6.6$ minutos), el crank solicita una nueva semilla sin requerir intervención manual del administrador.
- **Estados del Sorteo**: \`AwaitingYield\`, \`AwaitingRandomness\`, \`Complete\`, \`Skipped\` (acumulación), \`Voided\`, \`ForceUnlocked\`, \`HaltedInsolvent\`, \`HaltedYieldSpike\`.
      `,
    },
  },
  {
    slug: "yield-breakdown",
    categorySlug: "2-protocol-mechanics",
    categoryTitle: { en: "Protocol Mechanics", es: "Mecánica del Protocolo" },
    title: {
      en: "Huma Yield Breakdown & APY",
      es: "Desglose de Rendimiento Huma y APY",
    },
    summary: {
      en: "How yield is calculated, interest distribution math, multi-tier allocations, and pot rollover protection.",
      es: "Cómo se calcula el rendimiento, matemática de distribución, niveles y protección de acumulación de bote.",
    },
    tags: ["yield", "huma", "apy", "math", "prizes", "rollover", "threshold"],
    content: {
      en: `
# Huma Yield Breakdown & Prize Tiers

YieldBonds converts variable institutional credit APY into prize distributions.

---

## Yield Source: Huma Finance Credit Vaults

Deposited USDC earns interest via Huma Finance's institutional credit facilities. For example:
- **Pool Total Deposited Principal**: $1,000,000.00 USDC
- **Huma Credit APY**: $7.50\\%$ annual return
- **Weekly Yield Generated**: $\\approx 1,442.30$ USDC

The entire $1,442.30 USDC generated in a single 7-day cycle forms the prize pot for that cycle's draw!

---

## Prize Tier Allocation Rules

Prize pools distribute winnings across configurable tiers where total shares equal exactly 10,000 basis points (100%):

$$\\sum (\\text{num\\_winners} \\times \\text{basis\\_points}) = 10,000 \\text{ bps}$$

Example 2-Tier Configuration:
- **Tier 1 (Grand Prize)**: 1 Winner $\\times 7,000$ bps ($70.00\\%$) $= $1,009.61 USDC
- **Tier 2 (Secondary Prizes)**: 3 Winners $\\times 1,000$ bps ($10.00\\%$) $= $144.23 USDC each

---

## Minimum Prize Pot Target & Rollover Protection

To protect users from micro-yield draws during quiet periods, each pool configures a \`min_yield_threshold\` (e.g. $100.00 USDC):
- If the harvested yield is below the threshold, the draw is marked as **Skipped**.
- **100% of Yield Rolls Over**: All accrued yield remains in the Huma credit pool, compounding into an even larger prize pot for the next cycle without risking depositor principal.
      `,
      es: `
# Desglose de Rendimiento Huma y Niveles de Premios

YieldBonds convierte el rendimiento APY de crédito institucional en distribuciones de premios.

---

## Fuente de Rendimiento: Fondos de Crédito Huma Finance

El USDC depositado genera intereses a través de las facilidades de crédito institucional de Huma Finance. Por ejemplo:
- **Principal Total Depositado**: $1,000,000.00 USDC
- **APY de Crédito Huma**: $7.50\\%$ de retorno anual
- **Rendimiento Semanal Generado**: $\\approx 1,442.30$ USDC

¡Los $1,442.30 USDC generados en un ciclo de 7 días constituyen el bote de premios para el sorteo de ese ciclo!

---

## Reglas de Asignación por Niveles de Premios

Los fondos de premios distribuyen los premios en niveles configurables donde la suma total es exactamente 10,000 puntos básicos (100%):

$$\\sum (\\text{num\\_winners} \\times \\text{basis\\_points}) = 10,000 \\text{ bps}$$

Ejemplo de Configuración de 2 Niveles:
- **Nivel 1 (Gran Premio)**: 1 Ganador $\\times 7,000$ bps ($70.00\\%$) $= $1,009.61 USDC
- **Nivel 2 (Premios Secundarios)**: 3 Ganadores $\\times 1,000$ bps ($10.00\\%$) $= $144.23 USDC cada uno

---

## Objetivo Mínimo de Bote y Protección de Acumulación (Rollover)

Para proteger a los usuarios de sorteos con rendimientos insignificantes, cada fondo define un \`min_yield_threshold\` (ej. $100.00 USDC):
- Si el rendimiento cosechado es inferior al umbral, el sorteo se marca como **Omitido (Skipped)**.
- **100% del Rendimiento se Acumula**: Todo el rendimiento permanece en Huma Finance, sumándose para formar un bote aún mayor en el siguiente ciclo sin arriesgar el capital principal.
      `,
    },
  },
  {
    slug: "risk-disclosures",
    categorySlug: "2-protocol-mechanics",
    categoryTitle: { en: "Protocol Mechanics", es: "Mecánica del Protocolo" },
    title: {
      en: "Security & Risk Disclosures",
      es: "Divulgación de Seguridad y Riesgos",
    },
    summary: {
      en: "Smart contract security audits, Huma credit risks, circuit breakers, and timelocks.",
      es: "Auditorías de contratos, riesgos de crédito en Huma, interruptores de circuito y bloqueos temporales.",
    },
    tags: [
      "security",
      "risk",
      "audit",
      "disclosure",
      "circuit breaker",
      "timelock",
      "multisig",
    ],
    content: {
      en: `
# Security & Risk Disclosures

While YieldBonds is engineered as a **Zero-Loss** savings protocol, interacting with decentralized finance (DeFi) smart contracts involves specific technical and economic risk factors.

---

## Automated Circuit Breakers

To safeguard depositor principal, YieldBonds features built-in autonomous circuit breakers in the Anchor smart contract:

1. **Protocol Solvency Parity (\`YieldVenueInsolvent\`)**:
   If Huma credit reserve balance drops below the total deposited principal book value, the pool is immediately halted to prevent deficit extractions.
2. **Yield Velocity Ceiling (\`YieldVelocityExceeded\`)**:
   If reported single-cycle yield exceeds the configured velocity ceiling (e.g. $> 500$ bps / 5.0% per week), the pool automatically pauses to guard against oracle manipulation or accounting anomalies.
3. **Settlement Timelocks (\`PayoutTimelockActive\`)**:
   Every completed draw enforces a mandatory 5-minute pause prior to payout execution, allowing automated monitoring bots to detect anomalies.

---

## Smart Contract Auditing & Multisig Governance

- **Rigorous In-Process Testing**: Smart contract logic is verified with over 100+ comprehensive LiteSVM integration tests covering edge cases, math overflows, and reentrancy vectors.
- **Multisig Governance**: Administrative operations (such as fee updates or emergency unpauses) are governed by a **Squads v4 Multisig** requiring multiple independent signer approvals.
- **Underlying Credit Facility Risk**: Yield is dependent on Huma Finance institutional borrowers. Underperforming credit portfolios may temporarily reduce weekly prize pot sizes.
      `,
      es: `
# Divulgación de Seguridad y Riesgos

Aunque YieldBonds está diseñado como un protocolo de ahorro **Sin Pérdidas**, interactuar con contratos inteligentes de finanzas descentralizadas (DeFi) implica riesgos técnicos y económicos específicos.

---

## Interruptores de Circuito Autónomos (Circuit Breakers)

Para salvaguardar el capital de los depositantes, YieldBonds incluye interruptores de circuito automáticos en su contrato Anchor:

1. **Paridad de Solvencia del Protocolo (\`YieldVenueInsolvent\`)**:
   Si el saldo de la reserva de Huma cae por debajo del valor contable del principal depositado, el fondo se detiene de inmediato para evitar extracciones deficitarias.
2. **Límite de Velocidad de Rendimiento (\`YieldVelocityExceeded\`)**:
   Si el rendimiento reportado en un solo ciclo supera el límite de seguridad (ej. $> 500$ bps / 5.0% semanal), el fondo se pausa automáticamente para protegerse contra anomalías contables o manipulación de oráculos.
3. **Bloqueo Temporal de Liquidación (\`PayoutTimelockActive\`)**:
   Cada sorteo completado impone una pausa obligatoria de 5 minutos antes del desembolso de premios para permitir la auditoría por bots de monitoreo.

---

## Auditoría de Contratos y Gobernanza Multisig

- **Pruebas Rigurosas LiteSVM**: La lógica de los contratos inteligentes está respaldada por más de 100 pruebas de integración LiteSVM que cubren desbordamientos matemáticos, reentrancia y casos extremos.
- **Gobernanza Multisig**: Las operaciones administrativas críticas están protegidas por un **Squads v4 Multisig** que requiere la aprobación de múltiples firmantes independientes.
- **Riesgo de Fondos de Crédito**: El rendimiento depende de los prestatarios institucionales de Huma Finance. Un menor rendimiento de los portafolios de crédito puede reducir temporalmente el monto del bote de premios.
      `,
    },
  },

  // ==========================================
  // Category 3: In-App Guidance (3 Articles)
  // ==========================================
  {
    slug: "microcopy-dictionary",
    categorySlug: "3-in-app-help",
    categoryTitle: { en: "In-App Guidance", es: "Guía en la Aplicación" },
    title: {
      en: "Plain-Language Crypto Glossary",
      es: "Glosario Cripto en Lenguaje Sencillo",
    },
    summary: {
      en: "Translations of complex Web3 terms into clear, human-friendly UX copy.",
      es: "Traducción de términos técnicos de Web3 a un lenguaje claro y amigable.",
    },
    tags: ["glossary", "terms", "dictionary", "ux", "microcopy"],
    content: {
      en: `
# Plain-Language Crypto Glossary

We eliminate unnecessary jargon across the YieldBonds interface. Here is our translation guide:

---

| Technical Term | YieldBonds Plain Term | Plain-Language Definition |
| :--- | :--- | :--- |
| **Gas Fee / Priority Fee** | **Network Fee** | The small cost in SOL required to execute a blockchain transaction. |
| **Public Key / Base58 Address** | **Account Address** | Your wallet's public receiving identifier on Solana. |
| **Sign Transaction** | **Confirm Action** | Approving a transaction prompt inside your connected wallet extension. |
| **PDA (Program Derived Address)** | **Protocol Account / Vault** | An on-chain account managed strictly by smart contracts to store pool funds or bond records. |
| **Blockhash Expired** | **Transaction Timeout** | The network was congested and the validity window expired. You may safely retry. |
| **Remaining Winnings** | **Dust Balance** | Fractional winnings ($< 1.00$ USDC) accumulating to unlock Bonus Bonds or for manual claim. |
| **Active Bonds** | **Eligible Draw Tickets** | Bonds currently locked in the pool earning entries for every weekly prize draw. |
| **Pending Bonds** | **Queued Tickets** | Deposits made in the current cycle that activate at the next harvest snapshot. |
| **Bonus Bond** | **Loyalty / Dust Bond** | A full ticket earned automatically from aggregated prior fractional winnings. |
| **Settlement Timelock** | **Verification Pause** | A 5-minute safety delay after winner selection allowing open public audit before payout. |
| **Draw Target** | **Minimum Pot Threshold** | The required yield for a draw; if unmet, 100% of yield rolls over to the next cycle. |
      `,
      es: `
# Glosario Cripto en Lenguaje Sencillo

Eliminamos tecnicismos innecesarios en la interfaz de YieldBonds. Esta es nuestra guía de traducción:

---

| Término Técnico | Término Sencillo | Definición en Lenguaje Claro |
| :--- | :--- | :--- |
| **Gas Fee / Priority Fee** | **Comisión de Red** | Pequeño costo en SOL requerido para procesar una transacción en la blockchain. |
| **Public Key / Base58 Address** | **Dirección de Cuenta** | El identificador público para recibir fondos en tu billetera en Solana. |
| **Sign Transaction** | **Confirmar Acción** | Aprobar la solicitud de transacción dentro de tu extensión de billetera. |
| **PDA (Program Derived Address)** | **Cuenta del Protocolo / Vault** | Cuenta administrada por contratos inteligentes para almacenar fondos o registros de bonos. |
| **Blockhash Expired** | **Tiempo de Espera Agotado** | La red estaba ocupada y la ventana de validez caducó. Puedes reintentar con total seguridad. |
| **Remaining Winnings** | **Saldo Residual (Dust)** | Ganancias fraccionarias ($< 1.00$ USDC) que se acumulan para desbloquear Bonos de Bonificación o para retiro. |
| **Active Bonds** | **Bonos Activos** | Bonos depositados en el fondo con derecho a participar en cada sorteo semanal. |
| **Pending Bonds** | **Bonos en Espera** | Depósitos del ciclo actual que se activan en la próxima captura de cosecha. |
| **Bonus Bond** | **Bono de Bonificación** | Un bono completo generado automáticamente de la agregación de saldos residuales. |
| **Settlement Timelock** | **Pausa de Verificación** | Pausa de seguridad de 5 minutos tras el sorteo para permitir la auditoría pública antes del pago. |
| **Draw Target** | **Meta Mínima del Bote** | Rendimiento mínimo para realizar el sorteo; si no se alcanza, el 100% se acumula para el siguiente ciclo. |
      `,
    },
  },
  {
    slug: "transaction-states",
    categorySlug: "3-in-app-help",
    categoryTitle: { en: "In-App Guidance", es: "Guía en la Aplicación" },
    title: {
      en: "Transaction Lifecycle States",
      es: "Estados del Ciclo de Transacción",
    },
    summary: {
      en: "Understanding the 6 progress stages during on-chain execution in TransactionProgressModal.",
      es: "Comprende las 6 etapas de progreso durante la ejecución en cadena en TransactionProgressModal.",
    },
    tags: [
      "transaction",
      "lifecycle",
      "states",
      "signing",
      "confirmation",
      "progress",
    ],
    content: {
      en: `
# Transaction Lifecycle States

When performing actions on YieldBonds (depositing, withdrawing, claiming prizes), transactions advance through 6 distinct UI states managed by the \`TransactionProgressModal\`:

\`\`\`
[IDLE] ──► [PREPARING] ──► [SIGNING] ──► [BROADCASTING] ──► [CONFIRMING] ──► [SUCCESS] / [ERROR]
\`\`\`

---

## Detailed Stage Breakdown

1. **Idle (\`idle\`)**: No active transaction; modal is closed or waiting for user initiation.
2. **Preparing (\`preparing\`)**:
   - The dApp constructs the Solana transaction instructions.
   - Fetches fresh blockhashes and simulates execution to estimate priority network fees.
3. **Signing (\`signing\`)**:
   - Your wallet prompts you to approve the action.
   - If you reject the prompt (Code \`4001\`), the modal closes quietly without showing a scary error alert.
4. **Broadcasting / Submitting (\`broadcasting\` / \`submitting\`)**:
   - The cryptographically signed payload is submitted to Solana RPC validator nodes.
5. **Confirming (\`confirming\`)**:
   - The transaction signature is polled across cluster nodes until reaching confirmed/finalized commitment.
   - An explorer link to Solscan is displayed for live tracking.
6. **Success / Error (\`success\` / \`error\`)**:
   - **Success**: A green banner confirms on-chain execution with updated balance reflections.
   - **Error**: If execution fails, \`TransactionErrorDetails\` translates the raw error into plain language with step-by-step resolution advice.
      `,
      es: `
# Estados del Ciclo de Transacción

Al realizar acciones en YieldBonds (depositar, retirar, reclamar premios), las transacciones pasan por 6 estados visuales claros gestionados por el componente \`TransactionProgressModal\`:

\`\`\`
[INACTIVO] ──► [PREPARANDO] ──► [FIRMANDO] ──► [ENVIANDO] ──► [CONFIRMANDO] ──► [ÉXITO] / [ERROR]
\`\`\`

---

## Desglose Detallado de Etapas

1. **Inactivo (\`idle\`)**: No hay transacción en curso; el modal está cerrado o esperando que el usuario inicie una acción.
2. **Preparando (\`preparing\`)**:
   - La aplicación construye las instrucciones de la transacción en Solana.
   - Obtiene un recent blockhash fresco y simula la ejecución para estimar las comisiones de red.
3. **Firmando (\`signing\`)**:
   - Tu billetera solicita tu aprobación explícita.
   - Si rechazas la solicitud (Código \`4001\`), el modal se cierra discretamente sin alarmas de error innecesarias.
4. **Enviando (\`broadcasting\` / \`submitting\`)**:
   - El paquete firmado criptográficamente se envía a los nodos validadores RPC de Solana.
5. **Confirmando (\`confirming\`)**:
   - La firma de la transacción se monitorea hasta alcanzar la confirmación en la red.
   - Se muestra un enlace a Solscan para seguimiento en tiempo real.
6. **Éxito / Error (\`success\` / \`error\`)**:
   - **Éxito**: Una notificación verde confirma la ejecución en cadena con actualización de saldos.
   - **Error**: Si la transacción falla, \`TransactionErrorDetails\` traduce el error a lenguaje sencillo con pasos de resolución.
      `,
    },
  },
  {
    slug: "contextual-tooltips",
    categorySlug: "3-in-app-help",
    categoryTitle: { en: "In-App Guidance", es: "Guía en la Aplicación" },
    title: {
      en: "In-App Tooltips & UI Reference",
      es: "Tooltips y Referencia de la Interfaz",
    },
    summary: {
      en: "Comprehensive guide to interactive tooltips, warning banners, inspector modals, and badges.",
      es: "Guía completa de tooltips interactivos, avisos de advertencia, modales de inspección y badges.",
    },
    tags: [
      "tooltips",
      "ui",
      "indicators",
      "banners",
      "badges",
      "inspector",
      "ledger",
    ],
    content: {
      en: `
# In-App Tooltips & UI Reference

YieldBonds provides contextual guidance and visual indicators throughout the dApp:

---

## Interactive Components & Indicators

- **Help Tooltips (\`InteractiveTooltip\`)**: Hover or tap the ℹ️ icon next to APY, TVL, and Draw Target to view instant plain-language explanations.
- **Low SOL Warning Banner**: Appears automatically when your wallet holds $< 0.01$ SOL, reminding you to fund gas before attempting deposits.
- **Remaining Winnings Banner & Claim Modal (\`UnclaimedBanner\`)**: Displays your accumulated fractional dust balance and lets you claim it in a single click.
- **Bonus Bond Dust Badge (\`BonusBondDustBadge\`)**: Displays how much fractional dust is currently contributing toward unlocking your next bonus bond.
- **Minimum Yield Status (\`MinimumYieldStatus\`)**: Visual progress bar tracking whether the current cycle has reached its \`min_yield_threshold\` or will roll over.
- **Draw Cycle Inspector (\`DrawCycleInspectorModal\`)**: Full-screen modal detailing harvest slot, Switchboard randomness account, locked ticket count, prize pot, and payout timelocks.
- **Provable Fairness Verifier (\`ProvableFairnessVerifier\`)**: In-app mathematical verifier to independently recompute winning ticket numbers from VRF seeds.
- **Activity Feed & Filter System (\`ActivityFeed\`)**: Live search and event filters across your deposits, claims, and automated reinvestments.
- **Prize History Ledger (\`DrawTelemetryGrid\`)**: Complete historical ledger of past prize draws with CSV/JSON export actions.
      `,
      es: `
# Tooltips y Referencia de la Interfaz

YieldBonds ofrece orientación contextual e indicadores visuales en toda la aplicación:

---

## Componentes e Indicadores Interactivos

- **Tooltips Informativos (\`InteractiveTooltip\`)**: Pasa el cursor o toca el icono ℹ️ junto a APY, TVL y Meta del Bote para ver explicaciones instantáneas en lenguaje sencillo.
- **Aviso de SOL Bajo**: Aparece automáticamente cuando tu saldo es $< 0.01$ SOL, recordando recargar gas antes de depositar.
- **Banner de Ganancias Remanentes (\`UnclaimedBanner\`)**: Muestra tu saldo residual acumulado y te permite retirarlo con un solo clic.
- **Insignia de Bono de Bonificación (\`BonusBondDustBadge\`)**: Muestra cuánto saldo fraccionario está acumulado para desbloquear tu siguiente bono de bonificación.
- **Estado de Rendimiento Mínimo (\`MinimumYieldStatus\`)**: Barra de progreso visual que indica si el ciclo alcanzó el \`min_yield_threshold\` o se acumulará (rollover).
- **Inspector de Ciclos de Sorteo (\`DrawCycleInspectorModal\`)**: Modal que detalla el slot de cosecha, cuenta de aleatoriedad Switchboard, boletos bloqueados, bote y timelocks.
- **Verificador de Equidad Demostrable (\`ProvableFairnessVerifier\`)**: Herramienta matemática para recalcular deterministamente los boletos ganadores a partir de semillas VRF.
- **Registro de Actividad y Filtros (\`ActivityFeed\`)**: Búsqueda en vivo y filtros para depósitos, reclamos y reinversiones automáticas.
- **Historial de Sorteos (\`DrawTelemetryGrid\`)**: Registro histórico completo de sorteos anteriores con exportación en formato CSV y JSON.
      `,
    },
  },

  // ==========================================
  // Category 4: Troubleshooting (4 Articles)
  // ==========================================
  {
    slug: "common-errors",
    categorySlug: "4-troubleshooting",
    categoryTitle: {
      en: "Troubleshooting & Support",
      es: "Solución de Problemas y Soporte",
    },
    title: {
      en: "Solana Error Index & Decoder Tool",
      es: "Índice de Errores y Herramienta Decodificadora",
    },
    summary: {
      en: "Self-service lookup index and decoder tool for all 51 Anchor program error codes (6000-6050) and Solana RPC errors.",
      es: "Índice de búsqueda y decodificador para los 51 códigos de error de Anchor (6000-6050) y errores RPC de Solana.",
    },
    tags: [
      "errors",
      "decoder",
      "4001",
      "0x1770",
      "solana",
      "anchor",
      "6000",
      "6020",
      "6044",
      "6047",
    ],
    content: {
      en: `
# Solana Error Index & Decoder Tool

If your transaction fails or you copied an error code from a block explorer (e.g. Solscan), use our self-service lookup reference below to diagnose the issue and find step-by-step resolution advice.

> [!NOTE]
> *Note: When interacting directly within YieldBonds, real-time error toasts automatically parse and display actionable steps in the app UI.*

---

## Interactive Error Decoder

Use the interactive search tool below to lookup codes like \`4001\`, \`0x1\`, \`6000\`, \`6020\`, \`6044\`, \`6047\`, or \`BlockhashNotFound\`. Supports decimal and hex formats.
      `,
      es: `
# Índice de Errores y Herramienta Decodificadora

Si tu transacción falla o copiaste un código de error de un explorador (como Solscan), usa nuestra herramienta de consulta para diagnosticar el problema y encontrar soluciones paso a paso.

> [!NOTE]
> *Nota: Al interactuar directamente en YieldBonds, las notificaciones emergentes analizan y muestran la solución en tiempo real.*

---

## Decodificador Interactivo de Errores

Utiliza la herramienta de búsqueda a continuación para consultar códigos como \`4001\`, \`0x1\`, \`6000\`, \`6020\`, \`6044\`, \`6047\` o \`BlockhashNotFound\`. Admite formatos decimal y hexadecimal.
      `,
    },
  },
  {
    slug: "stuck-transactions",
    categorySlug: "4-troubleshooting",
    categoryTitle: {
      en: "Troubleshooting & Support",
      es: "Solución de Problemas y Soporte",
    },
    title: {
      en: "Resolving Stuck Transactions",
      es: "Resolución de Transacciones Atascadas",
    },
    summary: {
      en: "How to resolve pending transactions, understand blockhash expiry, and switch RPC nodes.",
      es: "Cómo resolver transacciones pendientes, entender la caducidad del blockhash y cambiar nodos RPC.",
    },
    tags: ["stuck", "pending", "rpc", "timeout", "network", "blockhash"],
    content: {
      en: `
# Resolving Stuck Transactions

During periods of extreme Solana network congestion, a transaction may appear stuck in a "Submitting" or "Confirming" state.

---

## Why Do Transactions Get Stuck?

Solana transactions carry a finite validity window governed by the **Recent Blockhash** (approximately 150 slots or 60–90 seconds). If network validators fail to include your transaction before the blockhash expires, the transaction simply drops safely without executing.

---

## 4-Step Resolution Playbook

1. **Wait 90 Seconds**: Do not spam duplicate transactions immediately. If the blockhash expires, the transaction will automatically fail cleanly with zero risk of duplicate execution.
2. **Inspect Solscan**: Copy your account address or transaction signature and check Solscan to verify whether the transaction confirmed.
3. **Clear Browser Cache & Refresh**: Refresh the dApp page to resynchronize your on-chain wallet balance.
4. **Retry with Priority Fees**: Ensure your wallet has at least 0.05 SOL to include priority micro-lamports for prioritized validator block inclusion.
      `,
      es: `
# Resolución de Transacciones Atascadas

Durante períodos de congestión en Solana, una transacción puede parecer atascada en estado "Enviando" o "Confirmando".

---

## ¿Por qué se Atascan las Transacciones?

Las transacciones de Solana tienen una validez determinada por el **Recent Blockhash** (aprox. 150 slots o 60–90 segundos). Si los validadores no la incluyen a tiempo, la transacción caduca automáticamente sin riesgo de ejecución duplicada.

---

## Guía de Resolución en 4 Pasos

1. **Espera 90 Segundos**: No envíes transacciones duplicadas de inmediato. Si caduca, fallará limpiamente.
2. **Verifica en Solscan**: Copia tu dirección o la firma y revisa en Solscan si fue confirmada.
3. **Actualiza la Página**: Recarga la dApp para resincronizar el saldo de tu billetera.
4. **Reintenta con Tarifas de Prioridad**: Asegúrate de tener al menos 0.05 SOL para tarifas de prioridad.
      `,
    },
  },
  {
    slug: "security-and-phishing",
    categorySlug: "4-troubleshooting",
    categoryTitle: {
      en: "Troubleshooting & Support",
      es: "Solución de Problemas y Soporte",
    },
    title: {
      en: "Official Links & Anti-Phishing Safety",
      es: "Enlaces Oficiales y Seguridad Anti-Phishing",
    },
    summary: {
      en: "Verified contract addresses, official domain list, multisig governance, and reporting channels.",
      es: "Direcciones de contrato verificadas, dominios oficiales, gobernanza multisig y reporte de fraudes.",
    },
    tags: [
      "security",
      "phishing",
      "domains",
      "contracts",
      "official",
      "multisig",
    ],
    content: {
      en: `
# Official Links & Anti-Phishing Safety

To protect your assets from impersonation scams and malicious phishing websites, always verify that you are accessing official YieldBonds resources.

---

## Verified Protocol Resources

- **Official Web dApp**: \`https://yieldbonds.io\` (Bookmark this URL)
- **Official Documentation**: \`https://yieldbonds.io/docs\`
- **Smart Contract Framework**: Anchor on Solana
- **Admin Governance**: Squads v4 Multisig

---

## Non-Negotiable Security Rules

> [!CAUTION]
> **NEVER**:
> - Enter your seed phrase into any website, form, or popup.
> - Trust direct messages from support staff on Discord, Twitter/X, or Telegram asking for funds or private keys.
> - Approve transaction prompts with unknown program IDs.
      `,
      es: `
# Enlaces Oficiales y Seguridad Anti-Phishing

Para proteger tus activos de sitios web falsos y estafas de phishing, verifica siempre que estés accediendo a recursos oficiales de YieldBonds.

---

## Recursos Verificados del Protocolo

- **Web dApp Oficial**: \`https://yieldbonds.io\` (Guarda este enlace en marcadores)
- **Documentación Oficial**: \`https://yieldbonds.io/docs\`
- **Framework de Smart Contracts**: Anchor en Solana
- **Gobernanza de Administración**: Squads v4 Multisig

---

## Reglas de Seguridad Innegociables

> [!CAUTION]
> **NUNCA**:
> - Ingreses tu frase semilla en ningún sitio web, formulario o ventana emergente.
> - Confíes en mensajes directos de personal de soporte en Discord, Twitter/X o Telegram solicitando fondos.
> - Apruebes solicitudes de transacción con IDs de programas desconocidos.
      `,
    },
  },
  {
    slug: "faq",
    categorySlug: "4-troubleshooting",
    categoryTitle: {
      en: "Troubleshooting & Support",
      es: "Solución de Problemas y Soporte",
    },
    title: {
      en: "Frequently Asked Questions (FAQ)",
      es: "Preguntas Frecuentes (FAQ)",
    },
    summary: {
      en: "Answers to 10 core questions about deposits, zero-loss safety, auto-reinvestment, timelocks, and withdrawals.",
      es: "Respuestas a 10 preguntas clave sobre depósitos, seguridad sin pérdidas, auto-reinversión, timelocks y retiros.",
    },
    tags: ["faq", "questions", "answers", "general", "no-loss", "safety"],
    content: {
      en: `
# Frequently Asked Questions (FAQ)

### 1. Can I lose my initial deposit?
**No.** YieldBonds is a zero-loss protocol. Your principal USDC deposit stays protected in non-custodial smart contracts. Only the interest yield earned via Huma Finance is awarded as prizes.

### 2. How are winning tickets chosen?
Winners are selected using Switchboard On-Demand VRF with a 44-byte SHA-256 hash derivation formula. Every draw is provably fair and can be verified independently on-chain.

### 3. How often are prize draws held?
Prize draws occur on a recurring stake cycle (typically weekly, 168 hours).

### 4. What happens when I win a prize?
Whole bond winnings automatically reinvest into new active prize bonds for the next draw. Fractional dust ($< 1.00$ USDC) accumulates in your remaining winnings balance to unlock Bonus Bonds or for manual withdrawal.

### 5. What are the protocol fees?
YieldBonds charges zero deposit or withdrawal fees. You only pay standard Solana network gas fees ($< 0.005$ USD). Protocol fees are deducted only from the harvested interest yield prior to prize distribution.

### 6. What is the Settlement Timelock?
Every completed draw enforces a 5-minute pause before payouts execute to allow open on-chain inspection and protect against race conditions.

### 7. What happens if a prize pot does not reach the minimum threshold?
If the harvested yield is below the pool's \`min_yield_threshold\`, the draw is skipped and 100% of the yield rolls over into the next cycle's prize pot.

### 8. How do withdrawals work?
You can withdraw your USDC deposits at any time. If liquidity is available in the vault, it executes instantly. If funds are deployed in Huma credit facilities, a pending redemption settles asynchronously.

### 9. What is a Bonus Bond?
A Bonus Bond is an additional active ticket automatically minted when accumulated fractional dust crosses the 1.00 USDC bond threshold.

### 10. Are the smart contracts audited?
Yes. Smart contracts are developed with Anchor in Rust, rigorously tested with LiteSVM in-process integration suites, and governed by Squads v4 multisig controls.
      `,
      es: `
# Preguntas Frecuentes (FAQ)

### 1. ¿Puedo perder mi depósito inicial?
**No.** YieldBonds es un protocolo sin pérdidas. Tu depósito principal de USDC permanece protegido en contratos inteligentes no custodiales. Solo los intereses de Huma Finance se otorgan como premios.

### 2. ¿Cómo se eligen los boletos ganadores?
Los ganadores se seleccionan mediante Switchboard On-Demand VRF con una fórmula criptográfica SHA-256 de 44 bytes. Cada sorteo es demostrablemente justo y verificable en cadena.

### 3. ¿Con qué frecuencia se realizan los sorteos?
Los sorteos se celebran en ciclos recurrentes (típicamente semanales, 168 horas).

### 4. ¿Qué sucede cuando gano un premio?
Los premios en bonos enteros se reinvierten automáticamente como nuevos bonos activos para el siguiente sorteo. Las fracciones ($< 1.00$ USDC) se acumulan en tu saldo remanente para desbloquear Bonos de Bonificación o para retiro manual.

### 5. ¿Cuáles son las comisiones del protocolo?
YieldBonds no cobra comisiones por depositar o retirar. Solo pagas las comisiones habituales de la red Solana ($< 0.005$ USD). Las comisiones del protocolo se deducen únicamente del rendimiento cosechado antes de repartir los premios.

### 6. ¿Qué es el Bloqueo Temporal de Liquidación (Settlement Timelock)?
Cada sorteo completado impone una pausa de seguridad de 5 minutos antes del pago para permitir la auditoría pública y proteger contra condiciones de carrera.

### 7. ¿Qué sucede si el bote no alcanza el objetivo mínimo?
Si el rendimiento cosechado es inferior al \`min_yield_threshold\`, el sorteo se omite y el 100% del rendimiento se acumula en el bote del siguiente ciclo.

### 8. ¿Cómo funcionan los retiros?
Puedes retirar tus depósitos de USDC en cualquier momento. Si hay liquidez en el vault, se ejecuta al instante. Si los fondos están invertidos en Huma, la redención pendiente se liquida de forma asíncrona.

### 9. ¿Qué es un Bono de Bonificación?
Un Bono de Bonificación es un boleto activo adicional emitido automáticamente cuando el saldo residual acumulado supera el umbral de 1.00 USDC.

### 10. ¿Están auditados los contratos inteligentes?
Sí. Los contratos inteligentes están desarrollados con Anchor en Rust, probados con suites de integración LiteSVM y gobernados por controles multisig Squads v4.
      `,
    },
  },
];

// =========================================================================
// Complete 51 Anchor Error Codes (6000-6050) + Standard Solana Errors
// =========================================================================
export const ERROR_LOOKUP_ITEMS: ErrorLookupItem[] = [
  // Standard Solana & Wallet Errors
  {
    code: "4001",
    name: "UserRejectedRequestError",
    summary: {
      en: "The transaction prompt was cancelled or denied inside your wallet.",
      es: "La solicitud de transacción fue cancelada o rechazada en tu billetera.",
    },
    diagnosis: {
      en: "The transaction approval prompt was declined or closed inside your wallet extension.",
      es: "La solicitud de aprobación de transacción fue cancelada o cerrada en tu extensión de billetera.",
    },
    solution: {
      en: "Re-open the transaction flow in YieldBonds and click 'Approve' when your wallet popup appears.",
      es: "Vuelve a iniciar la acción en YieldBonds y haz clic en 'Aprobar' cuando aparezca tu billetera.",
    },
    category: "wallet",
  },
  {
    code: "0x1",
    name: "InsufficientFundsForFee / InsufficientLamports",
    summary: {
      en: "Your wallet does not have enough SOL to cover network gas fees or account rent.",
      es: "Tu billetera no tiene suficiente SOL para pagar la comisión de red o la renta de cuenta.",
    },
    diagnosis: {
      en: "Your SOL balance is insufficient to pay for Solana network execution fees or refundable account rent.",
      es: "Tu saldo de SOL es insuficiente para pagar las comisiones de red de Solana o la renta de almacenamiento de cuentas.",
    },
    solution: {
      en: "Deposit at least 0.05 SOL into your wallet to pay for transaction fees and try again.",
      es: "Deposita al menos 0.05 SOL en tu billetera para pagar comisiones e inténtalo de nuevo.",
    },
    category: "balance",
  },
  {
    code: "BlockhashNotFound",
    name: "BlockheightExceeded / TransactionExpired",
    summary: {
      en: "The network was congested or wallet signing took longer than 60 seconds.",
      es: "La red estaba ocupada o la firma en la billetera tardó más de 60 segundos.",
    },
    diagnosis: {
      en: "The transaction validity window (recent blockhash) expired before validators could include it.",
      es: "La ventana de validez de la transacción (recent blockhash) caducó antes de que los validadores la incluyeran.",
    },
    solution: {
      en: "Approve the wallet prompt quickly when it appears, or retry the transaction.",
      es: "Aprueba la transacción rápidamente cuando aparezca la billetera o reintenta la operación.",
    },
    category: "network",
  },
  {
    code: "4900",
    name: "WalletDisconnectedError",
    summary: {
      en: "Your wallet disconnected unexpectedly.",
      es: "Tu billetera se desconectó inesperadamente.",
    },
    diagnosis: {
      en: "The connection between the dApp and your browser wallet extension was interrupted.",
      es: "La conexión entre la aplicación y tu extensión de billetera se interrumpió.",
    },
    solution: {
      en: "Click 'Connect Wallet' in the top navigation bar to reconnect.",
      es: "Haz clic en 'Conectar Billetera' en la barra superior para volver a conectar.",
    },
    category: "wallet",
  },

  // 51 Anchor Error Codes (6000 to 6050)
  {
    code: "6000",
    numericCode: 6000,
    hexCode: "0x1770",
    name: "PoolNotActive",
    diagnosis: {
      en: "The requested prize pool is currently not in Active status.",
      es: "El fondo de premios solicitado no se encuentra en estado Activo.",
    },
    solution: {
      en: "Wait for the protocol administrator to activate the prize pool or choose another active pool.",
      es: "Espera a que el administrador active el fondo o selecciona otro fondo activo.",
    },
    category: "anchor",
  },
  {
    code: "6001",
    numericCode: 6001,
    hexCode: "0x1771",
    name: "InvalidPoolStatus",
    diagnosis: {
      en: "An invalid pool lifecycle status transition was requested.",
      es: "Se solicitó una transición de estado de ciclo de vida no válida.",
    },
    solution: {
      en: "Ensure the pool status is valid (Active = 0, Paused = 1, Closed = 2).",
      es: "Asegúrate de que el estado del fondo sea válido (Activo = 0, Pausado = 1, Cerrado = 2).",
    },
    category: "admin",
  },
  {
    code: "6002",
    numericCode: 6002,
    hexCode: "0x1772",
    name: "CycleNotEnded",
    diagnosis: {
      en: "Attempted to harvest yield or execute a draw before the current stake cycle end timestamp has elapsed.",
      es: "Se intentó cosechar rendimiento o ejecutar un sorteo antes de que finalizara el ciclo de depósito.",
    },
    solution: {
      en: "Wait for the stake cycle countdown timer on the dashboard to reach 0 before triggering the draw crank.",
      es: "Espera a que el temporizador del ciclo en el panel llegue a 0 antes de ejecutar el sorteo.",
    },
    category: "crank",
  },
  {
    code: "6003",
    numericCode: 6003,
    hexCode: "0x1773",
    name: "InvalidBondQuantity",
    diagnosis: {
      en: "The requested bond purchase or redemption quantity is 0 or exceeds maximum allowable batch sizes.",
      es: "La cantidad de bonos solicitada es 0 o supera el tamaño máximo de lote permitido.",
    },
    solution: {
      en: "Enter a deposit or redemption amount of at least 1 whole bond (e.g. 1.00 USDC).",
      es: "Ingresa un monto de depósito o redención de al menos 1 bono entero (ej. 1.00 USDC).",
    },
    category: "anchor",
  },
  {
    code: "6004",
    numericCode: 6004,
    hexCode: "0x1774",
    name: "RegistryFull",
    diagnosis: {
      en: "The prize pool ticket registry has reached maximum entry capacity for its current allocated size.",
      es: "El registro de boletos del fondo ha alcanzado la capacidad máxima para su tamaño actual.",
    },
    solution: {
      en: "Wait for the automated crank to trigger dynamic account resizing (resize_registry).",
      es: "Espera a que el crank automático redimensione la cuenta (resize_registry).",
    },
    category: "crank",
  },
  {
    code: "6005",
    numericCode: 6005,
    hexCode: "0x1775",
    name: "RegistryTooSmall",
    diagnosis: {
      en: "The registry account allocation is smaller than the required initial header size.",
      es: "La asignación de la cuenta de registro es menor que el tamaño de cabecera inicial requerido.",
    },
    solution: {
      en: "Pre-allocate at least REGISTRY_INITIAL_SIZE bytes when initializing the ticket registry.",
      es: "Preasigna al menos REGISTRY_INITIAL_SIZE bytes al inicializar el registro de boletos.",
    },
    category: "admin",
  },
  {
    code: "6006",
    numericCode: 6006,
    hexCode: "0x1776",
    name: "RegistryAtMaxSize",
    diagnosis: {
      en: "The ticket registry account has reached Solana's maximum 10 MB account size limit.",
      es: "La cuenta del registro de boletos ha alcanzado el límite máximo de 10 MB en Solana.",
    },
    solution: {
      en: "The protocol will route new entries to supplementary registries or a new pool tier.",
      es: "El protocolo enrutará nuevas entradas a registros suplementarios o a un nuevo fondo.",
    },
    category: "anchor",
  },
  {
    code: "6007",
    numericCode: 6007,
    hexCode: "0x1777",
    name: "AwaitingRandomnessFreeze",
    diagnosis: {
      en: "The prize pool snapshot is frozen while awaiting oracle randomness resolution. Deposits and withdrawals are temporarily locked.",
      es: "La captura del fondo está congelada esperando la aleatoriedad del oráculo. Depósitos y retiros están pausados momentáneamente.",
    },
    solution: {
      en: "Wait a few moments (~1–2 minutes) for Switchboard VRF to resolve and winner payouts to be committed.",
      es: "Espera unos momentos (~1–2 minutos) a que Switchboard VRF resuelva el sorteo y se confirmen los premios.",
    },
    category: "anchor",
  },
  {
    code: "6008",
    numericCode: 6008,
    hexCode: "0x1778",
    name: "AlreadyClaimed",
    diagnosis: {
      en: "Attempted to claim a prize or redemption that has already been claimed or reinvested.",
      es: "Se intentó reclamar un premio o redención que ya ha sido reclamado o reinvertido.",
    },
    solution: {
      en: "Refresh your dashboard; your funds have already been credited to your wallet or active balance.",
      es: "Actualiza tu panel; tus fondos ya fueron transferidos a tu billetera o a tu saldo activo.",
    },
    category: "anchor",
  },
  {
    code: "6009",
    numericCode: 6009,
    hexCode: "0x1779",
    name: "MathOverflow",
    diagnosis: {
      en: "An arithmetic overflow or underflow occurred natively during calculation.",
      es: "Ocurrió un desbordamiento o subdesbordamiento aritmético durante el cálculo.",
    },
    solution: {
      en: "Verify input quantities and retry; contact protocol support if the issue persists.",
      es: "Verifica las cantidades ingresadas y reintenta; contacta a soporte si el problema continúa.",
    },
    category: "anchor",
  },
  {
    code: "6010",
    numericCode: 6010,
    hexCode: "0x177a",
    name: "InvalidWinnerIndex",
    diagnosis: {
      en: "The derived winner ticket index is out of bounds relative to the locked ticket count.",
      es: "El índice de boleto ganador derivado está fuera de los límites de boletos bloqueados.",
    },
    solution: {
      en: "Re-run winner selection with valid locked ticket bounds.",
      es: "Vuelve a ejecutar la selección de ganadores con límites válidos de boletos.",
    },
    category: "crank",
  },
  {
    code: "6011",
    numericCode: 6011,
    hexCode: "0x177b",
    name: "UnauthorizedCrank",
    diagnosis: {
      en: "Caller is not the authorized Switchboard Crank Jobs account.",
      es: "El firmante no es la cuenta autorizada de trabajos de crank de Switchboard.",
    },
    solution: {
      en: "Only designated off-chain crank services can invoke this instruction.",
      es: "Solo los servicios de crank autorizados pueden ejecutar esta instrucción.",
    },
    category: "crank",
  },
  {
    code: "6012",
    numericCode: 6012,
    hexCode: "0x177c",
    name: "InvalidPrizeTierConfig",
    diagnosis: {
      en: "Prize tier parameters are invalid (e.g. 0 winners or basis points out of range).",
      es: "Los parámetros del nivel de premios son inválidos (ej. 0 ganadores o puntos básicos fuera de rango).",
    },
    solution: {
      en: "Configure valid prize tier basis points with at least 1 winner per tier.",
      es: "Configura puntos básicos válidos con al menos 1 ganador por nivel.",
    },
    category: "admin",
  },
  {
    code: "6013",
    numericCode: 6013,
    hexCode: "0x177d",
    name: "PrizeTiersNotConfigured",
    diagnosis: {
      en: "Prize tiers have not been initialized for this pool.",
      es: "Los niveles de premios no han sido configurados para este fondo.",
    },
    solution: {
      en: "Pool admin must execute set_prize_tiers before draws can be performed.",
      es: "El administrador del fondo debe ejecutar set_prize_tiers antes de realizar sorteos.",
    },
    category: "admin",
  },
  {
    code: "6014",
    numericCode: 6014,
    hexCode: "0x177e",
    name: "BasisPointsMustEqual10000",
    diagnosis: {
      en: "Total basis points across all prize tiers do not sum to exactly 10,000 (100%).",
      es: "La suma de puntos básicos en todos los niveles de premios no equivale exactamente a 10,000 (100%).",
    },
    solution: {
      en: "Adjust prize tier percentages so that sum(basis_points * num_winners) equals exactly 10,000 bps.",
      es: "Ajusta los porcentajes para que la suma(basis_points * num_winners) sea exactamente 10,000 bps.",
    },
    category: "admin",
  },
  {
    code: "6015",
    numericCode: 6015,
    hexCode: "0x177f",
    name: "InvalidDrawStatus",
    diagnosis: {
      en: "The draw cycle account is in an invalid phase for the requested operation.",
      es: "La cuenta del ciclo de sorteo está en una fase no válida para la operación solicitada.",
    },
    solution: {
      en: "Verify draw cycle status (AwaitingYield, AwaitingRandomness, Complete, Skipped, Voided).",
      es: "Verifica el estado del sorteo (AwaitingYield, AwaitingRandomness, Complete, Skipped, Voided).",
    },
    category: "anchor",
  },
  {
    code: "6016",
    numericCode: 6016,
    hexCode: "0x1780",
    name: "InvalidDrawState",
    diagnosis: {
      en: "The draw cycle has an invalid locked ticket count or prize pot amount.",
      es: "El ciclo de sorteo tiene una cantidad inválida de boletos bloqueados o bote de premios.",
    },
    solution: {
      en: "Wait for yield harvest and locked ticket snapshot to complete before revealing winners.",
      es: "Espera a que se completen la cosecha y la captura de boletos antes de revelar ganadores.",
    },
    category: "anchor",
  },
  {
    code: "6017",
    numericCode: 6017,
    hexCode: "0x1781",
    name: "UnauthorizedAdmin",
    diagnosis: {
      en: "The transaction signer is not the authorized protocol administrator or Squads multisig.",
      es: "El firmante no es el administrador autorizado del protocolo ni el multisig Squads.",
    },
    solution: {
      en: "Connect with the authorized admin authority wallet to execute administrative functions.",
      es: "Conecta la billetera de administración autorizada para ejecutar funciones administrativas.",
    },
    category: "admin",
  },
  {
    code: "6018",
    numericCode: 6018,
    hexCode: "0x1782",
    name: "InvalidBondPrice",
    diagnosis: {
      en: "The bond price specified for pool creation or update is 0.",
      es: "El precio del bono especificado para el fondo es 0.",
    },
    solution: {
      en: "Specify a bond unit price greater than 0 base units (e.g. 1,000,000 for 1.00 USDC).",
      es: "Especifica un precio unitario mayor a 0 unidades base (ej. 1,000,000 para 1.00 USDC).",
    },
    category: "admin",
  },
  {
    code: "6019",
    numericCode: 6019,
    hexCode: "0x1783",
    name: "InvalidStakeCycleDuration",
    diagnosis: {
      en: "The stake cycle duration specified is 0 hours or negative.",
      es: "La duración del ciclo de depósito especificada es de 0 horas o negativa.",
    },
    solution: {
      en: "Set stake cycle duration to at least 1 hour (standard is 168 hours / 7 days).",
      es: "Configura la duración del ciclo en al menos 1 hora (lo habitual son 168 horas / 7 días).",
    },
    category: "admin",
  },
  {
    code: "6020",
    numericCode: 6020,
    hexCode: "0x1784",
    name: "HumaRedemptionNotSettled",
    diagnosis: {
      en: "Asynchronous liquidity redemption requested from Huma Finance credit pool has not yet settled.",
      es: "La redención de liquidez solicitada en Huma Finance aún no se ha liquidado en cadena.",
    },
    solution: {
      en: "Wait for the current Huma liquidity settlement cycle to complete before claiming your withdrawn USDC.",
      es: "Espera a que concluya el ciclo de liquidación de Huma antes de reclamar tu USDC retirado.",
    },
    category: "anchor",
  },
  {
    code: "6021",
    numericCode: 6021,
    hexCode: "0x1785",
    name: "InvalidRedemptionOwner",
    diagnosis: {
      en: "The transaction signer does not match the beneficiary recorded on the PendingRedemption account.",
      es: "El firmante no coincide con el beneficiario registrado en la cuenta PendingRedemption.",
    },
    solution: {
      en: "Connect the specific wallet address that created the pending redemption request.",
      es: "Conecta la dirección de billetera que originó la solicitud de redención pendiente.",
    },
    category: "anchor",
  },
  {
    code: "6022",
    numericCode: 6022,
    hexCode: "0x1786",
    name: "InsufficientFeeBalance",
    diagnosis: {
      en: "Attempted to withdraw more protocol fees than the accrued unwithdrawn balance.",
      es: "Se intentó retirar más comisiones del protocolo que el saldo acumulado no retirado.",
    },
    solution: {
      en: "Check total_fees_accrued - total_fees_withdrawn before attempting fee withdrawals.",
      es: "Verifica total_fees_accrued - total_fees_withdrawn antes de retirar comisiones.",
    },
    category: "admin",
  },
  {
    code: "6023",
    numericCode: 6023,
    hexCode: "0x1787",
    name: "NoWinningsToClaim",
    diagnosis: {
      en: "User has zero unclaimed non-reinvested winnings (dust balance) to withdraw.",
      es: "El usuario no tiene ganancias no reinvertidas (saldo residual) para retirar.",
    },
    solution: {
      en: "No action required; all prior winnings have already been claimed or compounded into active bonds.",
      es: "No se requiere acción; las ganancias anteriores ya fueron reclamadas o reinvertidas en bonos.",
    },
    category: "anchor",
  },
  {
    code: "6024",
    numericCode: 6024,
    hexCode: "0x1788",
    name: "InvalidFeeConfig",
    diagnosis: {
      en: "Configured protocol fee rate exceeds the maximum allowable 10,000 basis points (100%).",
      es: "La tasa de comisión configurada supera el límite máximo de 10,000 puntos básicos (100%).",
    },
    solution: {
      en: "Specify fee basis points between 0 and 10,000 (e.g. 250 bps = 2.5%).",
      es: "Especifica puntos básicos entre 0 y 10,000 (ej. 250 bps = 2.5%).",
    },
    category: "admin",
  },
  {
    code: "6025",
    numericCode: 6025,
    hexCode: "0x1789",
    name: "InvalidMaxYieldBasisPoints",
    diagnosis: {
      en: "The maximum yield velocity ceiling exceeds 10,000 basis points.",
      es: "El límite máximo de velocidad de rendimiento supera los 10,000 puntos básicos.",
    },
    solution: {
      en: "Configure a valid yield velocity ceiling limit (e.g. 500 bps = 5.0% per cycle).",
      es: "Configura un límite de velocidad válido (ej. 500 bps = 5.0% por ciclo).",
    },
    category: "admin",
  },
  {
    code: "6026",
    numericCode: 6026,
    hexCode: "0x178a",
    name: "InvalidPayoutTimelock",
    diagnosis: {
      en: "Payout timelock delay exceeds the maximum 86,400 seconds (24 hours).",
      es: "El tiempo de bloqueo de pago supera el máximo de 86,400 segundos (24 horas).",
    },
    solution: {
      en: "Specify a timelock delay between 0 and 86,400 seconds (standard is 300 seconds / 5 minutes).",
      es: "Especifica un tiempo de bloqueo entre 0 y 86,400 segundos (lo habitual son 300 segundos / 5 minutos).",
    },
    category: "admin",
  },
  {
    code: "6027",
    numericCode: 6027,
    hexCode: "0x178b",
    name: "InvalidModeMint",
    diagnosis: {
      en: "The SPL token mint does not match the pool's configured underlying deposit mint (e.g. USDC).",
      es: "El mint del token SPL no coincide con el mint configurado para el fondo (ej. USDC).",
    },
    solution: {
      en: "Ensure transactions pass the correct token mint account matching pool configuration.",
      es: "Asegúrate de pasar la cuenta de mint correcta que coincide con el fondo.",
    },
    category: "anchor",
  },
  {
    code: "6028",
    numericCode: 6028,
    hexCode: "0x178c",
    name: "InvalidRandomnessAccount",
    diagnosis: {
      en: "The provided randomness account is invalid, uninitialized, or does not belong to Switchboard.",
      es: "La cuenta de aleatoriedad es inválida, no está inicializada o no pertenece a Switchboard.",
    },
    solution: {
      en: "Ensure the randomness account was created via the official Switchboard On-Demand program.",
      es: "Asegúrate de que la cuenta de aleatoriedad fue creada con el programa Switchboard On-Demand.",
    },
    category: "crank",
  },
  {
    code: "6029",
    numericCode: 6029,
    hexCode: "0x178d",
    name: "RandomnessNotResolved",
    diagnosis: {
      en: "Switchboard VRF oracle network has not yet fulfilled and resolved the randomness seed.",
      es: "La red de oráculos Switchboard VRF aún no ha resuelto la semilla de aleatoriedad.",
    },
    solution: {
      en: "Wait a few seconds for oracle consensus and transaction confirmation on Solana.",
      es: "Espera unos segundos a que se alcance el consenso del oráculo en Solana.",
    },
    category: "crank",
  },
  {
    code: "6030",
    numericCode: 6030,
    hexCode: "0x178e",
    name: "StaleRandomnessRequest",
    diagnosis: {
      en: "The randomness request was committed before the harvest freeze slot or is expired.",
      es: "La solicitud de aleatoriedad se registró antes del slot de congelación o ha expirado.",
    },
    solution: {
      en: "Re-commit a fresh randomness request account after the yield harvest slot.",
      es: "Registra una nueva cuenta de aleatoriedad después del slot de cosecha.",
    },
    category: "crank",
  },
  {
    code: "6031",
    numericCode: 6031,
    hexCode: "0x178f",
    name: "RandomnessNotExpired",
    diagnosis: {
      en: "Attempted to re-lock or rebind a randomness account before its 1,000-slot expiration window elapsed.",
      es: "Se intentó re-bloquear una cuenta de aleatoriedad antes de transcurrir los 1,000 slots de expiración.",
    },
    solution: {
      en: "Wait until at least 1,000 slots have passed since the original randomness commitment.",
      es: "Espera a que transcurran al menos 1,000 slots desde la solicitud original.",
    },
    category: "crank",
  },
  {
    code: "6032",
    numericCode: 6032,
    hexCode: "0x1790",
    name: "InvalidUserEntryHint",
    diagnosis: {
      en: "The user entry index hint provided to the ticket registry is out of bounds or misaligned.",
      es: "El índice de entrada de usuario proporcionado al registro de boletos no es válido.",
    },
    solution: {
      en: "Re-fetch the user's latest ticket registry index from the chain before submitting transaction.",
      es: "Consulta el índice más reciente del usuario en cadena antes de enviar la transacción.",
    },
    category: "anchor",
  },
  {
    code: "6033",
    numericCode: 6033,
    hexCode: "0x1791",
    name: "InsufficientPendingTickets",
    diagnosis: {
      en: "User has fewer pending tickets than requested for sale or cancellation.",
      es: "El usuario tiene menos boletos pendientes que los solicitados para venta o cancelación.",
    },
    solution: {
      en: "Check your pending ticket balance and adjust the requested amount.",
      es: "Verifica tu saldo de boletos pendientes y ajusta la cantidad solicitada.",
    },
    category: "anchor",
  },
  {
    code: "6034",
    numericCode: 6034,
    hexCode: "0x1792",
    name: "InsufficientActiveTickets",
    diagnosis: {
      en: "User has fewer active tickets than requested for bond redemption.",
      es: "El usuario tiene menos boletos activos que los solicitados para redención.",
    },
    solution: {
      en: "Check your active bond balance on the dashboard and enter an amount within your balance.",
      es: "Verifica tu saldo de bonos activos en el panel e ingresa una cantidad dentro de tu saldo.",
    },
    category: "anchor",
  },
  {
    code: "6035",
    numericCode: 6035,
    hexCode: "0x1793",
    name: "PoolNotFrozen",
    diagnosis: {
      en: "The prize pool must be in a frozen state to perform draw preparation and ticket index indexing.",
      es: "El fondo de premios debe estar en estado congelado para preparar el sorteo.",
    },
    solution: {
      en: "Execute harvest_yield_and_commit first to freeze the pool snapshot before draw preparation.",
      es: "Ejecuta harvest_yield_and_commit primero para congelar el fondo antes de la preparación.",
    },
    category: "crank",
  },
  {
    code: "6036",
    numericCode: 6036,
    hexCode: "0x1794",
    name: "MissingSwappedUserWinnings",
    diagnosis: {
      en: "A required remaining account for the swapped user's UserWinnings PDA was not provided during lazy index reordering.",
      es: "Falta la cuenta PDA UserWinnings del usuario intercambiado durante la reorganización del registro.",
    },
    solution: {
      en: "Pass all necessary remaining accounts including the replaced user's UserWinnings PDA.",
      es: "Incluye todas las cuentas restantes necesarias, incluyendo el PDA UserWinnings.",
    },
    category: "crank",
  },
  {
    code: "6037",
    numericCode: 6037,
    hexCode: "0x1795",
    name: "InvalidFeeWallet",
    diagnosis: {
      en: "The destination token account does not match the configured protocol fee wallet.",
      es: "La cuenta de destino no coincide con la billetera de comisiones configurada.",
    },
    solution: {
      en: "Pass the registered fee wallet associated with the pool.",
      es: "Envía la billetera de comisiones registrada asociada al fondo.",
    },
    category: "admin",
  },
  {
    code: "6038",
    numericCode: 6038,
    hexCode: "0x1796",
    name: "CannotModifyBondPriceWithActiveDeposits",
    diagnosis: {
      en: "Cannot modify the bond unit price while the pool has active deposits, pending redemptions, or prizes.",
      es: "No se puede modificar el precio del bono mientras haya depósitos activos o redenciones pendientes.",
    },
    solution: {
      en: "Bond price can only be changed on newly created or empty pools.",
      es: "El precio del bono solo puede cambiarse en fondos nuevos o vacíos.",
    },
    category: "admin",
  },
  {
    code: "6039",
    numericCode: 6039,
    hexCode: "0x1797",
    name: "PoolPaused",
    diagnosis: {
      en: "The prize pool is paused due to an emergency circuit breaker or administrative action.",
      es: "El fondo de premios está pausado debido a un interruptor de circuito o acción administrativa.",
    },
    solution: {
      en: "Operations are temporarily suspended. Monitor protocol announcements or check admin multisig status.",
      es: "Las operaciones están temporalmente suspendidas. Monitorea los anuncios oficiales o el multisig.",
    },
    category: "anchor",
  },
  {
    code: "6040",
    numericCode: 6040,
    hexCode: "0x1798",
    name: "PoolClosed",
    diagnosis: {
      en: "The prize pool has been closed permanently. Deposits and bond purchases are disabled.",
      es: "El fondo de premios ha sido cerrado permanentemente. Los depósitos están deshabilitados.",
    },
    solution: {
      en: "You can still withdraw deposits and claim remaining dust winnings; new deposits are disallowed.",
      es: "Aún puedes retirar depósitos y reclamar ganancias remanentes; no se permiten nuevos depósitos.",
    },
    category: "anchor",
  },
  {
    code: "6041",
    numericCode: 6041,
    hexCode: "0x1799",
    name: "DrawVoided",
    diagnosis: {
      en: "This draw cycle was voided and rolled back by the protocol administrator.",
      es: "Este ciclo de sorteo fue anulado y revertido por el administrador del protocolo.",
    },
    solution: {
      en: "The yield has been rolled over to the next cycle; prizes for this cycle will not be disbursed.",
      es: "El rendimiento se acumuló para el siguiente ciclo; no se entregarán premios en este ciclo.",
    },
    category: "anchor",
  },
  {
    code: "6042",
    numericCode: 6042,
    hexCode: "0x179a",
    name: "DrawAlreadyVoided",
    diagnosis: {
      en: "Attempted to void a draw cycle that was already marked as voided.",
      es: "Se intentó anular un ciclo de sorteo que ya había sido anulado.",
    },
    solution: {
      en: "No further void action can be taken on this cycle.",
      es: "No se puede realizar ninguna otra acción de anulación en este ciclo.",
    },
    category: "admin",
  },
  {
    code: "6043",
    numericCode: 6043,
    hexCode: "0x179b",
    name: "PayoutsAlreadyStarted",
    diagnosis: {
      en: "Winner payouts or reinvestment cranks have already begun executing; draw cannot be voided.",
      es: "Los pagos a ganadores o cranks de reinversión ya comenzaron; el sorteo no puede anularse.",
    },
    solution: {
      en: "Once payouts begin, the draw must complete its normal disbursement flow.",
      es: "Una vez iniciados los pagos, el sorteo debe completar su flujo normal de desembolso.",
    },
    category: "admin",
  },
  {
    code: "6044",
    numericCode: 6044,
    hexCode: "0x179c",
    name: "PayoutTimelockActive",
    diagnosis: {
      en: "Settlement timelock is active (e.g. 5-minute pause after VRF winner reveal to protect against race conditions).",
      es: "El bloqueo temporal de liquidación está activo (pausa de 5 minutos tras el sorteo para evitar condiciones de carrera).",
    },
    solution: {
      en: "Wait for the timelock countdown timer to reach 0 before executing the payout crank or claiming prizes.",
      es: "Espera a que el temporizador de bloqueo llegue a 0 antes de ejecutar el crank de pago o reclamar premios.",
    },
    category: "anchor",
  },
  {
    code: "6045",
    numericCode: 6045,
    hexCode: "0x179d",
    name: "FeesAlreadyWithdrawn",
    diagnosis: {
      en: "Protocol fees from this cycle were already withdrawn; draw cannot be voided.",
      es: "Las comisiones del protocolo de este ciclo ya fueron retiradas; el sorteo no puede anularse.",
    },
    solution: {
      en: "Draw cycle is locked and cannot be rolled back after fee withdrawal.",
      es: "El ciclo de sorteo está bloqueado y no puede revertirse tras el retiro de comisiones.",
    },
    category: "admin",
  },
  {
    code: "6046",
    numericCode: 6046,
    hexCode: "0x179e",
    name: "YieldVelocityExceeded",
    diagnosis: {
      en: "Automated Circuit Breaker: Single-cycle yield exceeded the configured safety velocity ceiling.",
      es: "Interruptor de Circuito: El rendimiento de un solo ciclo superó el límite de velocidad de seguridad.",
    },
    solution: {
      en: "Pool is automatically paused to protect principal from yield spikes. Awaiting admin multisig audit.",
      es: "El fondo se pausa automáticamente para proteger el principal. Requiere auditoría del multisig.",
    },
    category: "anchor",
  },
  {
    code: "6047",
    numericCode: 6047,
    hexCode: "0x179f",
    name: "YieldVenueInsolvent",
    diagnosis: {
      en: "Automated Circuit Breaker: Huma credit reserve balance dropped below deposited principal book value.",
      es: "Interruptor de Circuito: La reserva de Huma cayó por debajo del valor contable del principal depositado.",
    },
    solution: {
      en: "Pool is paused to prevent deficit extraction. Emergency multisig intervention required.",
      es: "El fondo se pausa para evitar extracciones deficitarias. Requiere intervención de emergencia.",
    },
    category: "anchor",
  },
  {
    code: "6048",
    numericCode: 6048,
    hexCode: "0x17a0",
    name: "Unauthorized",
    diagnosis: {
      en: "Signer is not authorized to perform the requested instruction.",
      es: "El firmante no está autorizado para ejecutar la instrucción solicitada.",
    },
    solution: {
      en: "Ensure you are signing with the correct authority wallet for this operation.",
      es: "Asegúrate de firmar con la billetera de autoridad correcta para esta operación.",
    },
    category: "anchor",
  },
  {
    code: "6049",
    numericCode: 6049,
    hexCode: "0x17a1",
    name: "WinnerMismatch",
    diagnosis: {
      en: "Winner account provided does not match the computed winner in the payout registry.",
      es: "La cuenta del ganador proporcionada no coincide con el ganador registrado en el sorteo.",
    },
    solution: {
      en: "Pass the exact winner public key matching the deterministic ticket derivation.",
      es: "Envía la clave pública exacta del ganador que corresponde a la derivación del boleto.",
    },
    category: "crank",
  },
  {
    code: "6050",
    numericCode: 6050,
    hexCode: "0x17a2",
    name: "UnsupportedAccountVersion",
    diagnosis: {
      en: "Account data schema version is invalid or incompatible with the current program version.",
      es: "La versión del esquema de la cuenta es inválida o incompatible con la versión actual del programa.",
    },
    solution: {
      en: "Re-initialize or upgrade the account to the current version (CURRENT_VERSION = 1).",
      es: "Reinicializa o actualiza la cuenta a la versión actual (CURRENT_VERSION = 1).",
    },
    category: "anchor",
  },
];

// =========================================================================
// Query & Search Helper Utilities
// =========================================================================

/**
 * Normalizes text for search indexing by stripping combining Unicode diacritics (accents),
 * lowercasing, and trimming. Allows unaccented Spanish queries (e.g. "deposito") to match
 * accented text (e.g. "Depósito").
 */
export function normalizeSearchText(text: string): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Fetches a single documentation article by category and article slugs.
 */
export function getDocArticle(
  categorySlug: string,
  articleSlug: string
): DocArticle | undefined {
  return DOC_ARTICLES.find(
    (a) => a.categorySlug === categorySlug && a.slug === articleSlug
  );
}

/**
 * Fetches a documentation category by slug.
 */
export function getDocCategory(categorySlug: string): DocCategory | undefined {
  return DOC_CATEGORIES.find((c) => c.slug === categorySlug);
}

/**
 * Fetches all documentation articles belonging to a specific category.
 */
export function getDocArticlesByCategory(categorySlug: string): DocArticle[] {
  return DOC_ARTICLES.filter((a) => a.categorySlug === categorySlug);
}

/**
 * Returns previous and next articles relative to the current article for pagination.
 */
export function getAdjacentDocArticles(
  categorySlug: string,
  articleSlug: string
): { prev: DocArticle | null; next: DocArticle | null } {
  const currentIndex = DOC_ARTICLES.findIndex(
    (a) => a.categorySlug === categorySlug && a.slug === articleSlug
  );
  if (currentIndex === -1) return { prev: null, next: null };

  return {
    prev: currentIndex > 0 ? DOC_ARTICLES[currentIndex - 1] : null,
    next:
      currentIndex < DOC_ARTICLES.length - 1
        ? DOC_ARTICLES[currentIndex + 1]
        : null,
  };
}

/**
 * Searches documentation articles with multi-token matching and diacritics normalization.
 */
export function searchDocArticles(
  query: string,
  locale: string = "en"
): DocArticle[] {
  const cleanQuery = normalizeSearchText(query);
  if (!cleanQuery) return [];

  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const targetLocale = (locale === "es" ? "es" : "en") as SupportedLocale;

  return DOC_ARTICLES.filter((article) => {
    const title = normalizeSearchText(
      article.title[targetLocale] || article.title.en
    );
    const summary = normalizeSearchText(
      article.summary[targetLocale] || article.summary.en
    );
    const tags = normalizeSearchText(article.tags.join(" "));
    const content = normalizeSearchText(
      article.content[targetLocale] || article.content.en
    );

    const searchableBlob = `${title} ${summary} ${tags} ${content}`;
    return tokens.every((token) => searchableBlob.includes(token));
  });
}

/**
 * Searches error lookup items by error code (decimal or hex), name, diagnosis, or solution.
 */
export function searchErrorLookupItems(
  query: string,
  locale: string = "en"
): ErrorLookupItem[] {
  const cleanQuery = normalizeSearchText(query);
  if (!cleanQuery) return [];

  const targetLocale = (locale === "es" ? "es" : "en") as SupportedLocale;

  return ERROR_LOOKUP_ITEMS.filter((item) => {
    const code = normalizeSearchText(item.code);
    const hex = item.hexCode ? normalizeSearchText(item.hexCode) : "";
    const numeric = item.numericCode ? String(item.numericCode) : "";
    const name = normalizeSearchText(item.name);
    const diagnosis = normalizeSearchText(
      item.diagnosis[targetLocale] || item.diagnosis.en
    );
    const solution = normalizeSearchText(
      item.solution[targetLocale] || item.solution.en
    );

    return (
      code.includes(cleanQuery) ||
      hex.includes(cleanQuery) ||
      numeric.includes(cleanQuery) ||
      name.includes(cleanQuery) ||
      diagnosis.includes(cleanQuery) ||
      solution.includes(cleanQuery)
    );
  });
}
