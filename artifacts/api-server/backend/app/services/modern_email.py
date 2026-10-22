"""Fixed email-safe EVEXIA Modern presentation, independent of device theme."""


def modern_html(event):
    invitation = event in ("account_invitation", "mr_invitation")
    mr = event == "mr_invitation"
    title = ("Welcome to the MR portal" if mr else "Welcome to the Admin workspace") if invitation else "Reset your password"
    intro = ('You are invited to the EVEXIA {{portal_name}}. Your User ID is <strong>{{login_id}}</strong>.'
             if invitation else "A password reset was requested for your EVEXIA account.")
    action = "Set password" if invitation else "Reset password"
    warning = ("If unexpected, ignore this email. Existing credentials remain unchanged until acceptance."
               if invitation else "If you did not request this, ignore this email. Your password has not changed.")
    if event is None:
        title, intro, action = "A message from EVEXIA", "Here is your message from {{company_name}}.", "Continue"
        warning = "This is an unassigned template. Review the content and link wording before saving."
    return (
        '<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f5fa;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#28263a"><tr><td align="center">'
        '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #ddd7e5;border-radius:16px;border-collapse:separate">'
        '<tr><td style="padding:28px;background-color:#f0eaf5;text-align:center">'
        '<img src="/images/evexia-logo.png" alt="EVEXIA Life Sciences" width="154" height="80">'
        '<p style="font-size:12px;color:#6c5d7f;letter-spacing:1px;margin:16px 0">EVEXIA LIFE SCIENCES</p></td></tr>'
        '<tr><td style="padding:28px;line-height:1.7">'
        f'<h1 style="font-size:26px;line-height:1.3;color:#187368;margin:0 0 24px">{title}</h1>'
        '<p>Hello {{recipient_name}},</p>'
        f'<p>{intro}</p>'
        '<p style="margin:28px 0;text-align:center"><a href="{{reset_url}}" style="display:inline-block;background-color:#187368;color:#ffffff;padding:16px 28px;border-radius:8px;font-weight:bold;text-decoration:none">'
        + action + '</a></p>'
        '<p>This one-use link expires in {{expiry_minutes}} minutes.</p>'
        '<p style="font-size:13px;color:#5d586b">If the button does not work, copy and paste this URL into your browser:</p>'
        '<p style="font-size:13px;overflow-wrap:anywhere"><a href="{{reset_url}}" style="color:#187368;text-decoration:underline">{{reset_url}}</a></p>'
        f'<p style="font-size:13px;color:#5d586b">{warning}</p>'
        '<hr style="border:1px solid #ddd7e5"><p style="font-size:12px;color:#6c5d7f">{{company_name}}</p>'
        '</td></tr></table></td></tr></table>'
    )
