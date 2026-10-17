"""Literal, single-pass rendering; authored source and delivered HTML are separate."""
import re
from dataclasses import dataclass
from html import escape, unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit

VARIABLES = ("recipient_name", "company_name", "reset_url", "expiry_minutes")
TOKEN = re.compile(r"\{\{([a-z][a-z0-9_]*)\}\}")
LOGO_CID = "evexia-logo@evexia"
LOGO_SOURCE = "/images/evexia-logo.png"
TAGS = set("table tbody thead tfoot tr td th p div span br hr strong b em i u small h1 h2 h3 h4 ul ol li a img".split())
ATTRS = set("align valign width height cellpadding cellspacing border colspan rowspan alt title style".split())
STYLE_PROPERTIES = set("background-color color padding padding-top padding-bottom padding-left padding-right margin margin-top margin-bottom margin-left margin-right font-family font-size font-weight font-style text-align text-decoration line-height letter-spacing border border-radius border-collapse max-width width height display overflow-wrap".split())


def tokens(source, allowed):
    found = set(TOKEN.findall(source))
    remainder = TOKEN.sub("", source)
    # CSS braces and template-code expressions are deliberately unsupported.
    if "{" in remainder or "}" in remainder or not found <= set(allowed):
        raise ValueError("Unknown, unavailable or malformed template variables.")
    return found


class DeliveryHTML(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.output = []
        self.links = 0
        self.visible_text = []
        self.stack = []
        self.feed(source)
        self.close()
        if self.stack:
            raise ValueError("Close all HTML formatting elements.")

    def handle_starttag(self, tag, attrs):
        if tag not in TAGS:
            raise ValueError("Unsupported HTML element.")
        if len({k for k, _ in attrs}) != len(attrs):
            raise ValueError("Duplicate HTML attributes.")
        clean = []
        for key, value in attrs:
            if value is None or re.search(r"[\x00-\x1f\x7f-\x9f]", value):
                raise ValueError("Invalid HTML attribute.")
            if key == "href" and tag == "a":
                if value != "{{reset_url}}":
                    raise ValueError("Recovery links must use exactly {{reset_url}}.")
                self.links += 1
            elif key == "src" and tag == "img":
                if value != LOGO_SOURCE:
                    raise ValueError("Only the bundled EVEXIA logo is supported.")
                value = "cid:" + LOGO_CID
            elif key not in ATTRS:
                raise ValueError("Unsupported HTML attribute.")
            elif "{{" in value or "}}" in value:
                raise ValueError("Variables are unavailable in formatting attributes.")
            elif key == "style":
                for declaration in value.split(";"):
                    if not declaration.strip():
                        continue
                    prop, sep, css = declaration.partition(":")
                    if (not sep or prop.strip().lower() not in STYLE_PROPERTIES
                            or not re.fullmatch(r"[a-zA-Z0-9 #.,%()\-]+", css.strip())
                            or re.search(r"url|expression|image|var\s*\(|attr\s*\(", css, re.I)):
                        raise ValueError("Unsupported inline styling.")
            clean.append(f'{key}="{escape(value, quote=True)}"')
        if tag == "a" and not any(k == "href" for k, _ in attrs):
            raise ValueError("Links require the server-owned reset URL.")
        if tag == "img" and not any(k == "src" for k, _ in attrs):
            raise ValueError("Images require the bundled logo.")
        self.output.append("<" + tag + (" " + " ".join(clean) if clean else "") + ">")
        if tag not in ("img", "br", "hr"):
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in ("img", "br", "hr"):
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag:
            raise ValueError("HTML elements must be correctly nested.")
        self.output.append(f"</{tag}>")

    def handle_data(self, data):
        self.visible_text.append(data)
        self.output.append(escape(data, quote=False))

    def handle_decl(self, decl):
        raise ValueError("HTML declarations are unsupported.")

    def unknown_decl(self, data):
        raise ValueError("HTML declarations are unsupported.")

    def handle_pi(self, data):
        raise ValueError("HTML processing instructions are unsupported.")


def validate_template(subject, html, text, event_key):
    if event_key not in (None, "password_recovery"):
        raise ValueError("Unsupported backend event.")
    tokens(subject, VARIABLES)
    tokens(html, VARIABLES)
    tokens(text, VARIABLES)
    if re.search(r"[\r\n\x00-\x1f\x7f-\x9f]", subject):
        raise ValueError("Invalid subject header.")
    parsed = DeliveryHTML(html)
    if event_key:
        visible = "".join(parsed.visible_text)
        if (not parsed.links or "{{reset_url}}" not in visible or "{{reset_url}}" not in text
                or "{{expiry_minutes}}" not in text or "{{expiry_minutes}}" not in visible):
            raise ValueError("Recovery requires a reset link, visible fallback URL and expiry in both HTML and plain text.")
        # Prevent author-supplied fallback destinations, including encoded URLs.
        if re.search(r"(?:https?|javascript|data|vbscript|file):|www\.", unescape(text + html), re.I):
            raise ValueError("Use {{reset_url}}, not an authored URL.")
    return "".join(parsed.output)


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


def render_recovery(template, *, recipient_name, reset_url, expiry_minutes):
    if template.event_key != "password_recovery":
        raise ValueError("Recovery event mapping unavailable.")
    url = urlsplit(reset_url)
    if (url.scheme != "https" or not url.hostname or url.username or url.password or url.query
            or url.path.rstrip("/") != "/reset-password"
            or not re.fullmatch(r"token=[A-Za-z0-9_.-]+", url.fragment)
            or re.search(r"[\s\\<>\"']", reset_url)):
        raise ValueError("Invalid server recovery URL.")
    # All values are server-owned. Names never become markup, attributes or headers.
    greeting = " ".join(str(recipient_name or "there").split())[:100]
    greeting = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", greeting) or "there"
    values = dict(recipient_name=greeting, company_name="EVEXIA LIFE SCIENCES",
                  reset_url=reset_url, expiry_minutes=str(expiry_minutes))
    html = validate_template(template.subject, template.html, template.text, template.event_key)
    def sub(source, html=False):
        return TOKEN.sub(lambda m: escape(values[m[1]], quote=True) if html else values[m[1]], source)
    subject = sub(template.subject)
    if re.search(r"[\x00-\x1f\x7f-\x9f]", subject) or len(subject) > 998:
        raise ValueError("Invalid rendered subject.")
    return RenderedEmail(subject, sub(template.text), sub(html, True))
