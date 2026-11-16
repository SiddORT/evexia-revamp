"""Authoring action uses the same fixed EVEXIA frame as delivered email."""
from app.services.email_presentation import presentation, ACCOUNT_TITLES


def modern_html(event):
    if event == "mr_immunotherapy_placed":
        from app.services.immunotherapy_placement_notification import EMAIL_HTML
        return presentation(EMAIL_HTML, title=ACCOUNT_TITLES[event])
    invitation = event in ("account_invitation", "mr_invitation")
    title = ACCOUNT_TITLES.get(event, "A message from EVEXIA")
    intro = ('You are invited to the EVEXIA {{portal_name}}. Your User ID is <strong>{{login_id}}</strong>.'
             if invitation else "A password reset was requested for your EVEXIA account.")
    action = "Set password" if invitation else "Reset password"
    warning = ("If unexpected, ignore this email. Existing credentials remain unchanged until acceptance."
               if invitation else "If you did not request this, ignore this email. Your password has not changed.")
    if event is None:
        intro, action = "Here is your message from {{company_name}}.", "Continue"
        warning = "This is an unassigned template. Review the content and link wording before saving."
    return presentation(
        '<p>Hello {{recipient_name}},</p>'
        f'<p>{intro}</p>'
        '<p style="margin:28px 0;text-align:center"><a href="{{reset_url}}" style="display:inline-block;'
        'background-color:#187368;color:#ffffff;padding:16px 28px;border-radius:8px;'
        'font-weight:bold;text-decoration:none">'
        + action + '</a></p>'
        '<p>This one-use link expires in {{expiry_minutes}} minutes.</p>'
        '<p style="font-size:13px;color:#5d586b">If the button does not work, copy and paste this URL into your browser:</p>'
        '<p style="font-size:13px;overflow-wrap:anywhere"><a href="{{reset_url}}" '
        'style="color:#187368;text-decoration:underline">{{reset_url}}</a></p>'
        f'<p style="font-size:13px;color:#5d586b">{warning}</p>'
        '<p style="font-size:12px;color:#5d506d">{{company_name}}</p>',
        title=title)
