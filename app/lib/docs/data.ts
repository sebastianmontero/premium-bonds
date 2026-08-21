export interface DocCategory {
  slug: string;
  icon: string;
  title: Record<string, string>;
  description: Record<string, string>;
}

export interface DocArticle {
  slug: string;
  categorySlug: string;
  categoryTitle: Record<string, string>;
  title: Record<string, string>;
  summary: Record<string, string>;
  content: Record<string, string>;
  tags: string[];
}

export interface ErrorLookupItem {
  code: string;
  name: string;
  summary: Record<string, string>;
  solution: Record<string, string>;
  category: "wallet" | "anchor" | "network" | "balance";
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
      es: "Índice de búsqueda de errores, solución de transaccionesatascadas, seguridad y preguntas frecuentes.",
    },
  },
];

export const DOC_ARTICLES: DocArticle[] = [
  // 1-getting-started
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
    tags: ["introduction", "overview", "basics", "no-loss"],
    content: {
      en: `
# Welcome to YieldBonds

YieldBonds is a **prize-linked savings protocol** built on the high-speed Solana blockchain. It combines the financial security of traditional savings with the excitement of recurring prize draws — without risking a single cent of your principal deposit.

---

## How Does it Work?

Unlike a lottery where your ticket money is spent forever, YieldBonds uses a **Zero-Loss Model**:

1. **Deposit USDC**: You deposit USDC into a YieldBonds pool. Every 1.00 USDC deposited grants you 1 Prize Bond.
2. **Earn Yield**: Your deposited principal is automatically routed to **Huma Finance** to generate institutional real-world asset (RWA) credit yield.
3. **Win Prizes**: The total accumulated yield generated across the pool is pooled together and awarded to lucky winner(s) during weekly draws powered by verifiable random functions (VRF).
4. **100% Principal Protection**: You can withdraw your full USDC deposit at any time.

---

## Key Benefits

> [!TIP]
> **Zero Risk to Principal**: Your initial deposit remains untouched in non-custodial smart contracts. Only the interest yield is distributed as prizes.

- **Non-Custodial**: You retain full ownership of your deposited assets.
- **Fair & Verifiable**: Draw winners are selected using on-chain Switchboard VRF randomness.
- **No Fixed Lock-Ups**: Withdraw your deposits whenever you need them.
      `,
      es: `
# Bienvenido a YieldBonds

YieldBonds es un **protocolo de ahorro con premios** creado en la blockchain de Solana. Combina la seguridad financiera de una cuenta de ahorro tradicional con la emoción de sorteos periódicos, sin arriesgar ni un solo centavo de tu depósito inicial.

---

## ¿Cómo Funciona?

A diferencia de una lotería tradicional donde el dinero del boleto se pierde, YieldBonds utiliza un **Modelo Sin Pérdidas**:

1. **Deposita USDC**: Depositas USDC en un fondo de YieldBonds. Cada 1.00 USDC depositado te otorga 1 Bono de Premio.
2. **Genera Rendimiento**: Tu capital depositado se canaliza automáticamente a **Huma Finance** para generar rendimiento a través de créditos de activos del mundo real (RWA).
3. **Gana Premios**: Todo el rendimiento acumulado en el fondo se agrupa y se distribuye a ganadores mediante sorteos semanales con aleatoriedad verificable en cadena (VRF).
4. **Protección del 100% del Principal**: Puedes retirar todo tu depósito de USDC en cualquier momento.

---

## Beneficios Clave

> [!TIP]
> **Cero Riesgo para tu Capital**: Tu depósito inicial permanece intacto en contratos inteligentes no custodiales. Solo los intereses generados se entregan como premios.

- **No Custodial**: Mantienes la propiedad total de tus activos depositados.
- **Justo y Verificable**: Los ganadores se eligen mediante aleatoriedad en cadena Switchboard VRF.
- **Sin Bloqueos Fijos**: Retira tus fondos cuando lo necesites.
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
    tags: ["wallet", "phantom", "solflare", "setup", "security"],
    content: {
      en: `
# Setting Up a Solana Wallet

To interact with YieldBonds, you need a web3 wallet compatible with the Solana network. We recommend using official browser extensions or mobile apps such as **Phantom**, **Solflare**, or **Backpack**.

---

## Recommended Wallets

| Wallet | Supported Platforms | Features |
| :--- | :--- | :--- |
| **Phantom** | Browser Extension, iOS, Android | Intuitive interface, high security, built-in swap. |
| **Solflare** | Browser Extension, iOS, Android | Advanced staking features, hardware wallet support. |
| **Backpack** | Browser Extension | xNFT support, developer friendly. |

---

## Step-by-Step Installation Guide

1. **Download the Extension**:
   Visit the official website of your chosen wallet (e.g. [phantom.app](https://phantom.app) or [solflare.com](https://solflare.com)). Never download wallet extensions from unverified third-party sources.

2. **Create a New Wallet**:
   Select **"Create New Wallet"** when prompted.

3. **Secure Your Recovery Phrase (Seed Phrase)**:
   You will be shown a 12-word or 24-word Secret Recovery Phrase. 

> [!CAUTION]
> **CRITICAL SECURITY WARNING**:
> - Write down your recovery phrase on paper and store it offline in a secure place.
> - **NEVER** share your recovery phrase or private key with anyone. YieldBonds team members will NEVER ask for your seed phrase.
> - Anyone with access to your recovery phrase can steal all assets stored in your wallet.

4. **Set a Strong Password**:
   Set an unlock password for daily use on your browser.
      `,
      es: `
# Configuración de una Billetera Solana

Para interactuar con YieldBonds, necesitas una billetera web3 compatible con la red Solana. Recomendamos usar extensiones de navegador u aplicaciones móviles oficiales como **Phantom**, **Solflare** o **Backpack**.

---

## Billeteras Recomendadas

| Billetera | Plataformas Soportadas | Características |
| :--- | :--- | :--- |
| **Phantom** | Extensión de Navegador, iOS, Android | Interfaz intuitiva, alta seguridad, intercambios integrados. |
| **Solflare** | Extensión de Navegador, iOS, Android | Funciones avanzadas de staking, soporte para hardware wallet. |
| **Backpack** | Extensión de Navegador | Soporte para xNFT, amigable para desarrolladores. |

---

## Guía Paso a Paso de Instalación

1. **Descarga la Extensión**:
   Visita el sitio web oficial de la billetera elegida (ej. [phantom.app](https://phantom.app) o [solflare.com](https://solflare.com)). Nunca descargues extensiones de fuentes no verificadas.

2. **Crea una Nueva Billetera**:
   Selecciona **"Crear Nueva Billetera"** cuando se te pida.

3. **Asegura tu Frase de Recuperación**:
   Se te mostrará una Frase Secreta de Recuperación de 12 o 24 palabras.

> [!CAUTION]
> **ADVERTENCIA DE SEGURIDAD CRÍTICA**:
> - Escribe tu frase de recuperación en papel y guárdala fuera de línea en un lugar seguro.
> - **NUNCA** compartas tu frase de recuperación ni tus claves privadas con nadie. El equipo de YieldBonds NUNCA te pedirá tu frase de recuperación.
> - Cualquier persona con acceso a tu frase de recuperación puede robar todos los activos de tu billetera.

4. **Establece una Contraseña Segura**:
   Configura una contraseña de desbloqueo para uso diario en tu navegador.
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
    tags: ["sol", "usdc", "network fee", "gas", "deposit"],
    content: {
      en: `
# Acquiring SOL & USDC

To participate in YieldBonds, your wallet needs two assets:
1. **SOL**: Solana's native cryptocurrency used to pay minimal **Network Fees** (gas fees) for transactions (usually $< 0.005 USD$ per transaction).
2. **USDC**: A 1:1 USD-pegged stablecoin used to purchase bonds and earn yields.

---

## 1. Getting SOL for Network Fees

Every blockchain operation (depositing, withdrawing, claiming prizes) requires a tiny amount of SOL to cover network execution.

- **Centralized Exchanges**: Purchase SOL on platforms like Coinbase, Kraken, Binance, or Phantom Pay, and withdraw it to your Solana account address.
- **Minimum Recommended SOL**: Maintain at least **0.05 SOL** in your wallet to cover account rent creation and gas fees smoothly.

---

## 2. Getting USDC for Deposits

YieldBonds operates primarily using **USDC on Solana** (SPL Token).

- **Swap inside Wallet**: If you hold SOL or USDT, you can use Phantom or Solflare's built-in swap feature to convert it to USDC.
- **Decentralized Exchanges (DEXs)**: Use Jupiter Aggregator ([jup.ag](https://jup.ag)) to swap tokens with low slippage.

> [!NOTE]
> Ensure you are holding **USDC (Solana SPL Token)** and not an Ethereum (ERC-20) version. Solana addresses start with alphanumeric characters (e.g. \`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\`).
      `,
      es: `
# Obtención de SOL y USDC

Para participar en YieldBonds, tu billetera necesita dos activos:
1. **SOL**: La criptomoneda nativa de Solana utilizada para pagar **Comisiones de Red** (gas) (usualmente $< 0.005 USD$ por transacción).
2. **USDC**: Una moneda estable vinculada 1:1 al dólar utilizada para comprar bonos y generar rendimientos.

---

## 1. Obtener SOL para Comisiones de Red

Cada operación en la blockchain (depositar, retirar, reclamar premios) requiere una pequeña cantidad de SOL para cubrir la ejecución de la red.

- **Intercambios Centralizados**: Compra SOL en plataformas como Coinbase, Kraken o Binance, y retíralo a tu dirección de Solana.
- **Mínimo Recomendado**: Mantén al menos **0.05 SOL** en tu billetera para cubrir la renta de cuentas y las comisiones.

---

## 2. Obtener USDC para Depósitos

YieldBonds opera principalmente con **USDC en Solana** (Token SPL).

- **Intercambio en Billetera**: Si tienes SOL o USDT, puedes usar la función de intercambio integrada de Phantom o Solflare para convertirlo a USDC.
- **Intercambios Descentralizados (DEX)**: Usa Jupiter Aggregator ([jup.ag](https://jup.ag)) para cambiar tokens con mínimo deslizamiento.

> [!NOTE]
> Asegúrate de tener **USDC (Token SPL de Solana)** y no versiones de Ethereum (ERC-20). Las direcciones de Solana son alfanuméricas.
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
    tags: ["security", "connection", "signing", "authorization"],
    content: {
      en: `
# Wallet Connection & Safety Guidelines

When using web3 dApps, understanding what permissions you grant to websites is essential for protecting your funds.

---

## Connecting Your Wallet (Read-Only Access)

When you click **[Connect Wallet]** on YieldBonds:
- You are ONLY granting the website permission to read your public wallet address and token balances.
- Connecting **CANNOT** spend funds, move tokens, or sign transactions without your explicit approval.

---

## Approving Transactions (Explicit Authorization)

When you deposit, withdraw, or claim prizes:
- Your connected wallet extension will pop up a window asking for your explicit confirmation.
- **Always inspect the transaction details**: Verify the destination address, network fee, and token amounts before clicking "Approve".

> [!WARNING]
> **Phishing Prevention Checklist**:
> 1. Check the browser URL bar: Ensure you are on the official YieldBonds domain.
> 2. Bookmark the official app URL. Never click links from unverified social media direct messages.
> 3. YieldBonds will NEVER ask for seed phrases, private keys, or blind transfers.
      `,
      es: `
# Conexión de Billetera y Guías de Seguridad

Al usar aplicaciones web3, comprender qué permisos otorgas a los sitios web es esencial para proteger tus fondos.

---

## Conectar tu Billetera (Acceso de Lectura)

Cuando haces clic en **[Conectar Billetera]** en YieldBonds:
- SOLO estás otorgando al sitio permiso para leer tu dirección pública y saldos de tokens.
- Conectarte **NO PUEDE** gastar fondos, mover tokens ni firmar transacciones sin tu aprobación explícita.

---

## Aprobar Transacciones (Autorización Explícita)

Cuando depositas, retiras o reclamas premios:
- La extensión de tu billetera mostrará una ventana pidiendo tu confirmación explícita.
- **Verifica siempre los detalles**: Revisa la dirección de destino, comisiones y montos de tokens antes de confirmar.

> [!WARNING]
> **Lista de Verificación Anti-Phishing**:
> 1. Verifica la barra de direcciones del navegador: Asegúrate de estar en el dominio oficial de YieldBonds.
> 2. Guarda el sitio en marcadores. Nunca hagas clic en enlaces de mensajes directos en redes sociales.
> 3. YieldBonds NUNCA solicitará frases semilla, claves privadas ni transferencias ciegas.
      `,
    },
  },

  // 2-protocol-mechanics
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
    tags: ["architecture", "huma", "yield", "pool", "vault"],
    content: {
      en: `
# No-Loss Yield Savings Architecture

YieldBonds operates a non-custodial, automated pool system built using the Anchor smart contract framework on Solana.

---

## Yield Generation via Huma Finance

All user USDC deposits are aggregated in the protocol vault account and routed into **Huma Finance** credit pools. Huma Finance generates competitive institutional yield backed by real-world assets (RWA).

\`\`\`
┌──────────────────┐      1:1 Deposit      ┌──────────────────┐
│  User USDC Wallet│ ────────────────────► │ YieldBonds Vault │
└──────────────────┘                       └────────┬─────────┘
                                                    │
                                                    ▼ (Deploys Capital)
┌──────────────────┐   Distributes Yield   ┌──────────────────┐
│ Prize Pool Pot   │ ◄──────────────────── │   Huma Finance   │
└────────┬─────────┘                       │   Credit Pool    │
         │                                 └──────────────────┘
         ▼ (VRF Draw)
┌──────────────────┐
│  Weekly Winner   │
└──────────────────┘
\`\`\`

> [!NOTE]
> **Multi-Yield Expansion**: Huma Finance is our launch yield partner. Support for additional verified yield providers will be integrated as the protocol grows.

---

## Zero-Loss Guarantee

Because only the *yield interest* earned from Huma Finance is placed into the prize pot, your underlying deposited principal is never spent or exposed to prize draw risk. When you withdraw, you receive 100% of your initial USDC back.
      `,
      es: `
# Arquitectura de Ahorro Rendimiento Sin Pérdidas

YieldBonds opera un sistema de fondos automatizado y no custodial desarrollado con el framework Anchor en Solana.

---

## Generación de Rendimiento con Huma Finance

Todos los depósitos de USDC se agrupan en la cuenta del vault del protocolo y se dirigen a los fondos de crédito de **Huma Finance**. Huma Finance genera un rendimiento competitivo respaldado por activos del mundo real (RWA).

\`\`\`
┌──────────────────┐     Depósito 1:1      ┌──────────────────┐
│ Billetera USDC   │ ────────────────────► │ Vault YieldBonds │
└──────────────────┘                       └────────┬─────────┘
                                                    │
                                                    ▼ (Despliega Capital)
┌──────────────────┐ Distribuye Rendimiento ┌──────────────────┐
│ Fondo de Premios │ ◄───────────────────── │   Huma Finance   │
└────────┬─────────┘                        │ Fondo de Crédito │
         │                                  └──────────────────┘
         ▼ (Sorteo VRF)
┌──────────────────┐
│ Ganador Semanal  │
└──────────────────┘
\`\`\`

> [!NOTE]
> **Expansión Futura**: Huma Finance es nuestro socio de rendimiento inicial. Se integrarán proveedores adicionales a medida que el protocolo se expanda.

---

## Garantía Sin Pérdidas

Dado que solo los *intereses generados* por Huma Finance se colocan en el bote de premios, tu capital inicial nunca se gasta ni se expone a riesgos de sorteo. Al retirar, recibes el 100% de tu USDC depositado.
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
      en: "1 USDC = 1 Bond ratio, bond registries, and withdrawal liquidity options.",
      es: "Relación 1 USDC = 1 Bono, registros de bonos y opciones de liquidez de retiro.",
    },
    tags: ["bonds", "deposit", "withdraw", "usdc", "registry"],
    content: {
      en: `
# Bonds & Deposit Mechanics

YieldBonds uses an efficient bond registry model to track prize draw eligibility.

---

## 1 USDC = 1 Prize Bond

- For every **1.00 USDC** you deposit into a pool, you receive **1 Prize Bond**.
- Your bonds remain active for every weekly prize draw as long as your USDC stays deposited.
- The more bonds you hold, the higher your statistical probability of winning the weekly draw.

---

## Bond Registries & On-Chain Storage

Bonds are recorded in your account's \`TicketRegistry\` Program Derived Address (PDA). YieldBonds uses an optimized dynamic byte allocation system on Solana to minimize rent storage costs while supporting millions of active bonds.

---

## Withdrawals & Liquidity

You can withdraw your USDC deposits at any time:
1. **Instant Redemptions**: Available directly when liquidity is idle in the vault.
2. **Huma Settlement Redemptions**: If funds are deployed in Huma Finance credit pools, redemptions settle as liquidity cycles refresh.
      `,
      es: `
# Mecánica de Bonos y Depósitos

YieldBonds utiliza un registro eficiente de bonos para realizar el seguimiento de elegibilidad en los sorteos.

---

## 1 USDC = 1 Bono de Premio

- Por cada **1.00 USDC** depositado, recibes **1 Bono de Premio**.
- Tus bonos permanecen activos en cada sorteo semanal mientras tu USDC permanezca depositado.
- Cuantos más bonos poseas, mayor será tu probabilidad estadística de ganar.

---

## Registro de Bonos y Almacenamiento

Los bonos se registran en tu cuenta \`TicketRegistry\` (PDA). YieldBonds utiliza un sistema dinámico optimizado en Solana para minimizar costos de renta manteniendo capacidad para millones de bonos.

---

## Retiros y Liquidez

Puedes retirar tus depósitos en cualquier momento:
1. **Redenciones Instantáneas**: Disponibles directamente cuando la liquidez está libre en el vault.
2. **Redenciones Huma**: Si los fondos están desplegados en Huma Finance, las redenciones se liquidan al completarse el ciclo.
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
      en: "Verifiable Random Function (VRF) mechanics ensuring provably fair prize selection.",
      es: "Mecánica de Función Aleatoria Verificable (VRF) para garantizar sorteos justos e inalterables.",
    },
    tags: ["vrf", "randomness", "switchboard", "draw", "winners"],
    content: {
      en: `
# Prize Draws & VRF Randomness

Transparency and fairness are the cornerstone of YieldBonds. Prize draw winners are selected using **Verifiable Random Functions (VRF)** powered by Switchboard Oracles.

---

## How VRF Selection Works

1. **Cycle Freeze**: At the end of each weekly cycle, the prize pool snapshot locks bond eligibility.
2. **Randomness Request**: The pool administrator or crank bot requests a VRF random seed from Switchboard.
3. **On-Chain Verification**: Switchboard oracle nodes submit proof of randomness that is mathematically verified by the Solana runtime.
4. **Winner Selection**: The random number is mapped across total active bond indexes to determine winning bond IDs cleanly and impartially.

---

## Auditability

Every draw cycle records:
- The VRF Randomness Seed signature.
- Total eligible bonds at snapshot time.
- Winning bond numbers and recipient addresses.

Anyone can verify past draw results on the Solana blockchain using Solscan.
      `,
      es: `
# Sorteos de Premios y Aleatoriedad VRF

La transparencia y la justicia son fundamentales en YieldBonds. Los ganadores de los sorteos se eligen utilizando **Funciones Aleatorias Verificables (VRF)** impulsadas por Switchboard Oracles.

---

## Cómo Funciona la Selección VRF

1. **Congelación de Ciclo**: Al final de cada ciclo semanal, se toma una captura del registro de bonos elegibles.
2. **Solicitud de Aleatoriedad**: Se solicita una semilla aleatoria VRF a Switchboard.
3. **Verificación en Cadena**: Los nodos de Switchboard envían una prueba matemática de aleatoriedad verificada por Solana.
4. **Selección del Ganador**: El número aleatorio se asigna al índice de bonos activos para determinar imparcialmente el ganador.

---

## Auditabilidad

Cada ciclo de sorteo registra en cadena:
- La firma de la semilla aleatoria VRF.
- Total de bonos elegibles al momento de la captura.
- Números de bonos ganadores y direcciones de los beneficiarios.
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
      en: "How yield is calculated, interest distribution math, and prize tier structuring.",
      es: "Cómo se calcula el rendimiento, matemática de distribución y estructuración de niveles de premios.",
    },
    tags: ["yield", "huma", "apy", "math", "prizes"],
    content: {
      en: `
# Huma Yield Breakdown & Prize Tiers

YieldBonds transforms variable yield APY into exciting prize distributions.

---

## Yield Source: Huma Finance

Deposited USDC yields interest through Huma Finance's institutional credit facilities. For example:
- **Pool TVL**: $1,000,000.00 USDC
- **Huma Average APY**: $7.50\\%$ annual return
- **Weekly Yield Generated**: $\\approx 1,442.30$ USDC

The entire $1,442.30 USDC generated in a week forms the prize pot for that cycle's draw!

---

## Prize Tier Allocations

Prize pools can distribute winnings across multiple tiers:
- **Grand Prize (70%)**: Awarded to 1 lucky single bond holder.
- **Runner-Up Prizes (30%)**: Split equally among secondary winners.

All amounts are formatted using standard \`en-US\` formatting with comma separators (e.g. \`$1,442.30 USDC\`).
      `,
      es: `
# Desglose de Rendimiento Huma y Niveles de Premios

YieldBonds transforma el rendimiento APY variable en emocionantes distribuciones de premios.

---

## Fuente de Rendimiento: Huma Finance

El USDC depositado genera intereses a través de las facilidades de crédito institucional de Huma Finance. Por ejemplo:
- **TVL del Fondo**: $1,000,000.00 USDC
- **APY Promedio de Huma**: $7.50\\%$ de retorno anual
- **Rendimiento Semanal Generado**: $\\approx 1,442.30$ USDC

¡Los $1,442.30 USDC generados en la semana forman el bote de premios para el sorteo de ese ciclo!

---

## Distribución de Niveles de Premios

Los fondos de premios distribuyen los premios en niveles:
- **Gran Premio (70%)**: Otorgado a 1 único boleto afortunado.
- **Premios Secundarios (30%)**: Dividido en partes iguales entre ganadores secundarios.
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
      en: "Smart contract security audits, Huma credit risks, and principal protection callouts.",
      es: "Auditorías de seguridad, riesgos de crédito en Huma y advertencias de protección de capital.",
    },
    tags: ["security", "risk", "audit", "disclosure", "huma"],
    content: {
      en: `
# Security & Risk Disclosures

While YieldBonds is designed as a **Zero-Loss** protocol to protect principal deposits, interacting with decentralized finance (DeFi) smart contracts carries inherent technical risks.

---

## Risk Factors to Understand

> [!WARNING]
> **Smart Contract Risk**: YieldBonds smart contracts are written in Rust using the Anchor framework. Although rigorously tested with LiteSVM and audited, software bugs or zero-day vulnerabilities in underlying Solana runtime code remain a theoretical risk.

> [!IMPORTANT]
> **Underlying Yield Source Risk**: Yield is generated via **Huma Finance** credit facilities. Borrowers or credit portfolio performance in Huma Finance directly impact the rate of interest generated for prize pots.

> [!NOTE]
> **Solana Network Congestion**: During extreme market volatility, Solana network congestion may temporarily delay transaction confirmation times or Switchboard VRF oracle resolution.
      `,
      es: `
# Divulgación de Seguridad y Riesgos

Aunque YieldBonds está diseñado como un protocolo **Sin Pérdidas** para proteger los depósitos principales, interactuar con contratos inteligentes de finanzas descentralizadas (DeFi) conlleva riesgos inherentes.

---

## Factores de Riesgo a Entender

> [!WARNING]
> **Riesgo de Contrato Inteligente**: Los contratos de YieldBonds están desarrollados en Rust con Anchor. Aunque han sido probados minuciosamente con LiteSVM, los errores de software representan un riesgo teórico.

> [!IMPORTANT]
> **Riesgo de Fuente de Rendimiento**: El rendimiento se genera a través de **Huma Finance**. El rendimiento de los portafolios de crédito impacta directamente la tasa de interés generada para los botes de premios.

> [!NOTE]
> **Congestión de la Red Solana**: Durante períodos de extrema volatilidad, la congestión en Solana puede retrasar temporalmente los tiempos de confirmación o la resolución del oráculo VRF.
      `,
    },
  },

  // 3-in-app-help
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
    tags: ["glossary", "terms", "dictionary", "ux"],
    content: {
      en: `
# Plain-Language Crypto Glossary

We avoid jargon wherever possible. Here is a guide to terms used in YieldBonds interface:

---

| Technical Term | YieldBonds Plain Term | Explanation |
| :--- | :--- | :--- |
| **Gas Fee / Priority Fee** | **Network Fee** | Small cost in SOL required to execute a blockchain transaction. |
| **Public Key / Address** | **Account Address** | Your wallet's public receiving identifier. |
| **Sign Transaction** | **Confirm Action** | Approving an operation inside your wallet extension. |
| **PDA (Program Derived Address)** | **Protocol Account / Vault** | An on-chain account managed by smart contracts to store funds or bond data. |
| **Blockhash Expired** | **Transaction Timeout** | The network was congested and your transaction needs to be retried. |
| **Slippage Tolerance** | **Price Difference Limit** | Maximum acceptable price variation during a token swap. |
      `,
      es: `
# Glosario Cripto en Lenguaje Sencillo

Evitamos los tecnicismos siempre que sea posible. Esta es la guía de términos usados en YieldBonds:

---

| Término Técnico | Término Sencillo | Explicación |
| :--- | :--- | :--- |
| **Gas Fee / Priority Fee** | **Comisión de Red** | Pequeño costo en SOL requerido para procesar una transacción. |
| **Public Key / Address** | **Dirección de Cuenta** | El identificador público para recibir fondos en tu billetera. |
| **Sign Transaction** | **Confirmar Acción** | Aprobar una operación dentro de tu extensión de billetera. |
| **PDA** | **Cuenta del Protocolo / Vault** | Cuenta administrada por contratos inteligentes para almacenar fondos o bonos. |
| **Blockhash Expired** | **Tiempo de Espera Agotado** | La red estaba ocupada y la transacción debe reintentarse. |
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
      en: "Understanding the 4 progress stages during on-chain execution.",
      es: "Comprende las 4 etapas de progreso durante la ejecución en cadena.",
    },
    tags: ["transaction", "lifecycle", "states", "signing", "confirmation"],
    content: {
      en: `
# Transaction Lifecycle States

When performing actions on YieldBonds, transactions transition through 4 distinct states:

\`\`\`
1. PREPARING ──► 2. SIGNING ──► 3. SUBMITTING ──► 4. CONFIRMED
\`\`\`

1. **Preparing**: The app builds the instruction payload and simulates execution to estimate network fees.
2. **Signing**: Your wallet prompts you to approve the action. If you cancel, the prompt closes with a neutral status toast.
3. **Submitting**: The signed transaction payload is sent to Solana RPC validators.
4. **Confirmed**: The transaction is verified on-chain. A green success banner displays with a Solscan explorer link.
      `,
      es: `
# Estados del Ciclo de Transacción

Al realizar acciones en YieldBonds, las transacciones pasan por 4 etapas claras:

\`\`\`
1. PREPARANDO ──► 2. FIRMANDO ──► 3. ENVIANDO ──► 4. CONFIRMADO
\`\`\`

1. **Preparando**: La app construye las instrucciones y simula la ejecución para calcular comisiones.
2. **Firmando**: Tu billetera solicita tu aprobación. Si cancelas, se cierra suavemente.
3. **Enviando**: La transacción firmada se envía a los validadores de Solana.
4. **Confirmado**: La transacción se confirma en la red. Aparece una notificación verde con un enlace a Solscan.
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
      en: "Guide to interactive tooltips, warning banners, and modal indicators.",
      es: "Guía de tooltips interactivos, avisos de advertencia e indicadores visuales.",
    },
    tags: ["tooltips", "ui", "indicators", "banners"],
    content: {
      en: `
# In-App Tooltips & UI Reference

YieldBonds provides contextual guidance throughout the dashboard:

- **Help Tooltips (ℹ️)**: Hover over or tap help icons next to labels like APY, TVL, and VRF to view instant definitions.
- **Low SOL Warning Banner**: Appears when your wallet holds less than 0.01 SOL, warning you to top up before attempting deposits.
- **Snapshot Freeze Indicator**: Appears during active draw snapshotting to indicate momentary deposit/withdraw pauses.
      `,
      es: `
# Tooltips y Referencia de la Interfaz

YieldBonds ofrece orientación contextual en toda la aplicación:

- **Iconos de Ayuda (ℹ️)**: Pasa el cursor sobre los iconos junto a etiquetas como APY o TVL para ver explicaciones.
- **Aviso de SOL Bajo**: Aparece cuando tu saldo es inferior a 0.01 SOL para recordarte recargar antes de depositar.
- **Indicador de Congelación**: Muestra cuándo se está realizando el sorteo semanal para pausar retiros brevemente.
      `,
    },
  },

  // 4-troubleshooting
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
      en: "Self-service lookup index and decoder tool for Solana RPC and Anchor program error codes.",
      es: "Índice de búsqueda y decodificador para códigos de error de Solana y Anchor.",
    },
    tags: ["errors", "decoder", "4001", "0x1770", "solana", "anchor"],
    content: {
      en: `
# Solana Error Index & Decoder Tool

If your transaction fails or you copied an error code from a block explorer (e.g. Solscan), use our self-service lookup reference below to diagnose the issue and find step-by-step resolution advice.

> [!NOTE]
> *Note: When interacting directly with YieldBonds, real-time error toasts automatically parse and display actionable steps in the app UI.*

---

## Interactive Error Decoder

Use the interactive search tool below to lookup codes like \`4001\`, \`0x1\`, \`0x1770\`, \`6000\`, or \`BlockhashNotFound\`.
      `,
      es: `
# Índice de Errores y Herramienta Decodificadora

Si tu transacción falla o copiaste un código de error de un explorador (como Solscan), usa nuestra herramienta de consulta para diagnosticar el problema y encontrar soluciones paso a paso.

> [!NOTE]
> *Nota: Al interactuar directamente en YieldBonds, las notificaciones emergentes analizan y muestran la solución en tiempo real.*

---

## Decodificador Interactivo de Errores

Utiliza la herramienta de búsqueda a continuación para consultar códigos como \`4001\`, \`0x1\`, \`0x1770\`, \`6000\` o \`BlockhashNotFound\`.
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
      en: "How to resolve pending transactions and switch RPC nodes.",
      es: "Cómo resolver transacciones pendientes y cambiar nodos RPC.",
    },
    tags: ["stuck", "pending", "rpc", "timeout", "network"],
    content: {
      en: `
# Resolving Stuck Transactions

Occasionally, during periods of extreme Solana network congestion, a transaction may appear stuck in a "Submitting" or "Pending" state.

---

## Why Do Transactions Get Stuck?

Solana transactions carry a finite validity window governed by the **Recent Blockhash** (approximately 60–90 seconds). If network validators fail to include your transaction before the blockhash expires, the transaction simply drops.

---

## Resolution Steps

1. **Wait 90 Seconds**: Do not send duplicate transactions immediately. If the blockhash expires, the transaction will automatically fail cleanly.
2. **Check Solscan**: Copy your wallet address and check Solscan to verify whether the transaction confirmed.
3. **Clear Browser Cache & Refresh**: Refresh the dApp page to resynchronize your wallet balance.
4. **Retry with Priority Fees**: Ensure your wallet has sufficient SOL to include priority micro-lamports for faster validator processing.
      `,
      es: `
# Resolución de Transacciones Atascadas

En ocasiones, durante períodos de congestión en Solana, una transacción puede parecer atascada en estado "Enviando" o "Pendiente".

---

## ¿Por qué se Atascan las Transacciones?

Las transacciones de Solana tienen una validez determinada por el **Recent Blockhash** (aprox. 60–90 segundos). Si los validadores no la incluyen a tiempo, la transacción caduca automáticamente.

---

## Pasos para Resolverlo

1. **Espera 90 Segundos**: No envíes transacciones duplicadas de inmediato. Si caduca, fallará limpiamente.
2. **Verifica en Solscan**: Copia tu dirección y revisa en Solscan si fue confirmada.
3. **Actualiza la Página**: Recarga la dApp para resincronizar el saldo de tu billetera.
4. **Reintenta con Tarifas de Prioridad**: Asegúrate de tener SOL suficiente para tarifas de prioridad.
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
      en: "Verified contract addresses, official domain list, and reporting suspicious activity.",
      es: "Direcciones de contrato verificadas, lista de dominios oficiales y reporte de fraudes.",
    },
    tags: ["security", "phishing", "domains", "contracts", "official"],
    content: {
      en: `
# Official Links & Anti-Phishing Safety

To protect your assets from impersonation scams and phishing websites, always verify that you are accessing official YieldBonds resources.

---

## Verified Protocol Information

- **Official Web dApp**: \`https://yieldbonds.io\` (Bookmark this URL)
- **Official GitHub Repository**: \`https://github.com\`
- **Solana Program Framework**: Built with Anchor on Solana

---

## Security Rules

> [!CAUTION]
> **NEVER**:
> - Enter your seed phrase into any website or popup.
> - Trust direct messages from support staff on Discord or Telegram asking for funds.
> - Approve transaction prompts with unknown contract program IDs.
      `,
      es: `
# Enlaces Oficiales y Seguridad Anti-Phishing

Para proteger tus activos de sitios web falsos y estafas de phishing, verifica siempre que estés accediendo a recursos oficiales de YieldBonds.

---

## Información Verificada del Protocolo

- **Web dApp Oficial**: \`https://yieldbonds.io\` (Guarda este enlace en marcadores)
- **Repositorio Oficial en GitHub**: \`https://github.com\`
- **Framework de Solana**: Desarrollado con Anchor en Solana

---

## Reglas de Seguridad

> [!CAUTION]
> **NUNCA**:
> - Ingreses tu frase semilla en ningún sitio web o ventana emergente.
> - Confíes en mensajes directos de personal de soporte solicitando fondos.
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
      en: "Answers to common questions about deposits, yield, draws, and security.",
      es: "Respuestas a preguntas habituales sobre depósitos, rendimiento, sorteos y seguridad.",
    },
    tags: ["faq", "questions", "answers", "general"],
    content: {
      en: `
# Frequently Asked Questions (FAQ)

### Can I lose my initial deposit?
**No.** YieldBonds is a zero-loss protocol. Your principal USDC deposit stays protected in non-custodial smart contracts. Only the yield earned via Huma Finance is awarded as prizes.

### How often are prize draws held?
Prize draws occur on a **weekly cycle**. At the end of each cycle, on-chain VRF randomness selects the winner(s).

### How do I claim my prize winnings?
If your bond is selected as a winner, prize winnings accumulate in your user account state. You can click **[Claim Prize Winnings]** on your dashboard to claim them directly to your wallet.

### What are the fees?
YieldBonds charges zero deposit or withdrawal fees. You only pay standard Solana network gas fees ($< 0.005 USD$).
      `,
      es: `
# Preguntas Frecuentes (FAQ)

### ¿Puedo perder mi depósito inicial?
**No.** YieldBonds es un protocolo sin pérdidas. Tu depósito principal de USDC permanece protegido en contratos inteligentes no custodiales. Solo los intereses de Huma Finance se otorgan como premios.

### ¿Con qué frecuencia se realizan los sorteos?
Los sorteos se celebran en un **ciclo semanal**. Al final de cada ciclo, la aleatoriedad en cadena (VRF) selecciona a los ganadores.

### ¿Cómo reclamo mis premios?
Si tu bono resulta ganador, las ganancias se acumulan en tu estado de usuario. Puedes hacer clic en **[Reclamar Ganancias]** en tu panel para transferirlas a tu billetera.

### ¿Cuáles son las comisiones?
YieldBonds no cobra comisiones por depositar o retirar. Solo pagas las comisiones habituales de la red Solana ($< 0.005 USD$).
      `,
    },
  },
];

export const ERROR_LOOKUP_ITEMS: ErrorLookupItem[] = [
  {
    code: "4001",
    name: "UserRejectedRequestError",
    summary: {
      en: "The transaction prompt was cancelled or denied inside your wallet.",
      es: "La solicitud de transacción fue cancelada o rechazada en tu billetera.",
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
    solution: {
      en: "Deposit at least 0.05 SOL into your wallet to pay for transaction fees and try again.",
      es: "Deposita al menos 0.05 SOL en tu billetera para pagar comisiones e inténtalo de nuevo.",
    },
    category: "balance",
  },
  {
    code: "0x1770",
    name: "AnchorCustomError (6000)",
    summary: {
      en: "Custom Anchor program error: PoolNotActive or CycleNotEnded.",
      es: "Error personalizado de Anchor: El fondo no está activo o el ciclo no ha terminado.",
    },
    solution: {
      en: "Ensure the prize pool is active and wait for the current draw cycle snapshot to resolve.",
      es: "Asegúrate de que el fondo esté activo y espera a que finalice el ciclo de sorteo.",
    },
    category: "anchor",
  },
  {
    code: "BlockhashNotFound",
    name: "BlockheightExceeded / TransactionExpired",
    summary: {
      en: "The network was congested or wallet signing took longer than 60 seconds.",
      es: "La red estaba ocupada o la firma en la billetera tardó más de 60 segundos.",
    },
    solution: {
      en: "Approve the wallet prompt quickly when it appears, or try again in a few seconds.",
      es: "Aprueba la transacción rápidamente cuando aparezca la billetera o reintenta en unos segundos.",
    },
    category: "network",
  },
  {
    code: "6022",
    name: "HumaRedemptionNotSettled",
    summary: {
      en: "Huma Protocol liquidity redemption is still settling on-chain.",
      es: "La redención de liquidez en Huma Protocol se está liquidando en cadena.",
    },
    solution: {
      en: "Please wait for the settlement window to conclude before claiming your funds.",
      es: "Por favor espera a que concluya la ventana de liquidación antes de reclamar tus fondos.",
    },
    category: "anchor",
  },
  {
    code: "6046",
    name: "PayoutTimelockActive",
    summary: {
      en: "Payout settlement timelock is active to protect against race conditions.",
      es: "El bloqueo temporal de liquidación de premios está activo para evitar condiciones de carrera.",
    },
    solution: {
      en: "Wait for the countdown timer on the prize row or inspector to expire (typically 5 minutes) before running the crank.",
      es: "Espera a que expire el temporizador de cuenta regresiva en la fila del premio o inspector (típicamente 5 minutos) antes de ejecutar el crank.",
    },
    category: "anchor",
  },
];

export function getDocArticle(
  categorySlug: string,
  articleSlug: string
): DocArticle | undefined {
  return DOC_ARTICLES.find(
    (a) => a.categorySlug === categorySlug && a.slug === articleSlug
  );
}

export function searchDocArticles(
  query: string,
  locale: string = "en"
): DocArticle[] {
  if (!query || query.trim().length === 0) return [];
  const q = query.toLowerCase().trim();

  return DOC_ARTICLES.filter((article) => {
    const title = (article.title[locale] || article.title["en"]).toLowerCase();
    const summary = (
      article.summary[locale] || article.summary["en"]
    ).toLowerCase();
    const content = (
      article.content[locale] || article.content["en"]
    ).toLowerCase();
    const tags = article.tags.join(" ").toLowerCase();

    return (
      title.includes(q) ||
      summary.includes(q) ||
      tags.includes(q) ||
      content.includes(q)
    );
  });
}
