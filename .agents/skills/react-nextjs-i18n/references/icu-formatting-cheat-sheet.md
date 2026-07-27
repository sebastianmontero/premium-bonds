# Reference Guide: ICU MessageFormat Syntax & Formatting Cheatsheet

ICU MessageFormat is the standard message syntax for localizing complex text strings across standard libraries (`next-intl`, `react-intl`, `formatjs`, `i18next-icu`).

---

## 1. Simple Variable Interpolation

```json
{
  "greeting": "Hello, {name}!"
}
```

---

## 2. Pluralization Syntax

ICU plurals handle complex language plural categories (`zero`, `one`, `two`, `few`, `many`, `other`).

### Basic Plural:

```json
{
  "unreadMessages": "{count, plural, =0 {No unread messages} one {You have 1 unread message} other {You have # unread messages}}"
}
```

_Note: `#` is replaced by the formatted count value._

### Complex Multi-Category Plural (e.g. Arabic / Slavic languages):

```json
{
  "itemCount": "{count, plural, =0 {لا يوجد عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصراً} other {# عنصر}}"
}
```

---

## 3. Select Category (Gender / Enums)

Match string enums, options, or genders cleanly:

```json
{
  "userRole": "{role, select, admin {Administrator} editor {Content Editor} viewer {Standard Viewer} other {Guest User}}",
  "genderUpdate": "{gender, select, female {She updated her photo} male {He updated his photo} other {They updated their photo}}"
}
```

---

## 4. Nested ICU Expressions (Select + Plural)

Combine `select` and `plural` for highly dynamic strings:

```json
{
  "notification": "{gender, select, female {She sent {count, plural, one {a message} other {# messages}}} male {He sent {count, plural, one {a message} other {# messages}}} other {They sent {count, plural, one {a message} other {# messages}}}}"
}
```

---

## 5. Rich Text & HTML Tag Formatting

Do not embed raw HTML in translation JSON files. Use tag interpolation placeholders so translators cannot break HTML structure or introduce XSS vulnerabilities.

### Dictionary JSON:

```json
{
  "privacyNotice": "Please read our <termsLink>Terms of Service</termsLink> and <privacyLink>Privacy Policy</privacyLink> carefully."
}
```

### Component Usage (`next-intl` / `react-intl`):

```tsx
import { useTranslations } from "next-intl";

export function PrivacyNotice() {
  const t = useTranslations("Legal");

  return (
    <p>
      {t.rich("privacyNotice", {
        termsLink: (chunks) => (
          <a href="/terms" className="text-blue-600 underline">
            {chunks}
          </a>
        ),
        privacyLink: (chunks) => (
          <a href="/privacy" className="text-blue-600 underline">
            {chunks}
          </a>
        ),
      })}
    </p>
  );
}
```

---

## 6. Number & Currency Formatting

Instead of manual string concatenation, use built-in formatters or ICU number syntax.

### JSON Syntax:

```json
{
  "priceDisplay": "Total price: {amount, number, currency}",
  "percentComplete": "Progress: {val, number, percent}"
}
```

### Server/Client Hook Formatter API:

```typescript
import { useFormatter } from 'next-intl';

export function PriceBadge({ amount }: { amount: number }) {
  const format = useFormatter();

  // Formats correctly based on user's locale (e.g. "$1,250.00" vs "1 250,00 €" vs "١٬٢٥٠٫٠٠ US$")
  const formattedPrice = format.number(amount, {
    style: 'currency',
    currency: 'USD'
  });

  return <span className="font-mono">{formattedPrice}</span>;
}
```

---

## 7. Date, Time & Relative Time Formatting

```typescript
import { useFormatter } from 'next-intl';

export function EventTimestamp({ date }: { date: Date }) {
  const format = useFormatter();

  return (
    <div>
      {/* Absolute Date: e.g. "July 26, 2026" */}
      <p>{format.dateTime(date, { dateStyle: 'full' })}</p>

      {/* Relative Time: e.g. "5 minutes ago" / "in 2 days" / "منذ ٥ دقائق" */}
      <p>{format.relativeTime(date)}</p>
    </div>
  );
}
```
