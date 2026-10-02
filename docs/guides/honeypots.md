# Honeypots

> [!NOTE]
> **Planned: milestone M1** (`@realhuman/client`). This page describes the intended behaviour.

A **honeypot** is a trap that people can't see or reach, but bots stumble into. If a hidden form field
gets filled in, a program did it, not a person. Honeypots are among the most reliable bot signals there are.

realHuman's honeypots only **record** that a trap was triggered. They never block a form submission.

## Quick setup

Add `data-realhuman` to any form you want protected:

```html
<form data-realhuman action="/signup" method="post">
  …your fields…
</form>
```

That's it. The SDK finds these forms when it starts, and when they're added later, and adds a trap field
to each one.

To protect a form you create in code:

```ts
rh.attach(document.querySelector('#checkout-form'));
```

To use a different selector, or every form on the page:

```ts
init({ honeypot: { forms: 'form' } });
```

## The four kinds of trap

| Trap | How it catches bots | Default |
|---|---|---|
| **Hidden field** | An invisible input that form-filling bots complete | On |
| **Time trap** | The form is submitted faster than a person could fill it in (`minFillMs`, default 1500 ms) | On |
| **Trap link** | An invisible link that crawlers follow but people never see | Off: `honeypot: { trapLink: true }` |
| **Agent canary** | Hidden text with instructions that AI agents reading the page may obey | Off: `honeypot: { agentCanary: true }` |

The **agent canary** is designed to catch LLM-driven browsers. It's off by default because you may want to
treat AI agents differently from other bots; see [verified agents](../reference/data-formats.md#verdict).

> [!NOTE]
> The **trap link** needs a matching path on your server that returns `204`. The adapters provide it at
> `{endpoint}/t`. Make sure your `robots.txt` disallows that path so well-behaved crawlers like Googlebot
> aren't counted as bots.

## Why realHuman's honeypots don't catch real people

Badly built honeypots cause false alarms: password managers fill them in, screen readers announce them, or
keyboard users tab into them. realHuman follows current best practice to avoid this:

| Risk | What realHuman does |
|---|---|
| Bots skip fields hidden with `display:none` or `type="hidden"` | Hides the field visually (clipped and positioned off-screen), so it still looks like a real field in the page |
| Keyboard users tab into it | Wraps it in an `inert` container with `tabindex="-1"` |
| Screen readers announce it | `aria-hidden="true"` and `inert` hide it from assistive technology |
| Browser autofill fills it | Uses a random name each time that doesn't match any autofill pattern, and an `autocomplete` value browsers ignore |
| Password managers fill it | Adds the opt-out attributes recognised by 1Password, LastPass, Bitwarden and Dashlane |
| Bots learn the field name | The name changes on every page load |
| A strict CSP blocks inline styles | Styles are set through the CSSOM, which CSP allows |

## Server-side form handling

You don't need to change your form handler. The honeypot field is ignored by your server. If you want to be
tidy, you can drop any field whose name starts with the honeypot prefix (shown in `debug` mode).

## Checking it works

1. Add `data-realhuman` to a form and open the page with `init({ debug: true })`.
2. In the browser console, fill in the hidden field by hand:
   ```js
   document.querySelector('[data-realhuman-hp] input').value = 'test';
   ```
3. Submit the form.

✅ The next decision record should contain the reason code `honeypot_filled` and a score near `0`.
