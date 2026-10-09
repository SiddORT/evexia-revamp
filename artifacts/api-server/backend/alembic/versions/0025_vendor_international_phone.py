"""Expand vendor phones only; preserve all existing records and identity history.

Country snapshot from libphonenumber metadata. Number validity is enforced at
the API/import boundary; the database additionally enforces country and digits.
Operator approval is required before applying this to managed databases.
"""
from alembic import op
import sqlalchemy as sa

revision = "0025_vendor_phone"
down_revision = "0024_opening_balances"
branch_labels = depends_on = None
COUNTRIES = "AC,AD,AE,AF,AG,AI,AL,AM,AO,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GT,GU,GW,GY,HK,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TA,TC,TD,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,XK,YE,YT,ZA,ZM,ZW".split(",")
LEGACY_PHONE = (
    '("dialCountry" = \'IN\' AND "phoneNo" ~ \'^[6-9][0-9]{9}$\') OR '
    '("dialCountry" IN (\'US\', \'GB\') AND "phoneNo" ~ \'^[0-9]{10}$\') OR '
    '("dialCountry" = \'AE\' AND "phoneNo" ~ \'^[0-9]{9}$\')'
)


def upgrade():
    op.drop_constraint("ck_vendor_phone", "vendors", type_="check")
    op.drop_constraint("ck_vendor_phoneNo_length", "vendors", type_="check")
    op.alter_column("vendors", "phoneNo", existing_type=sa.String(10), type_=sa.String(15))
    op.create_check_constraint("ck_vendor_phoneNo_length", "vendors",
                               'length("phoneNo") BETWEEN 1 AND 15 AND "phoneNo" = btrim("phoneNo")')
    country_sql = ",".join(f"'{country}'" for country in COUNTRIES)
    op.create_check_constraint("ck_vendor_country", "vendors", f'"dialCountry" IN ({country_sql})')
    op.create_check_constraint("ck_vendor_phone", "vendors", LEGACY_PHONE +
        ' OR ("dialCountry" NOT IN (\'IN\',\'US\',\'GB\',\'AE\') AND "phoneNo" ~ \'^[0-9]{4,15}$\')')


def downgrade():
    if op.get_bind().scalar(sa.text(f"SELECT EXISTS (SELECT 1 FROM vendors WHERE NOT ({LEGACY_PHONE}))")):
        raise RuntimeError("Refusing to narrow international vendor history")
    op.drop_constraint("ck_vendor_country", "vendors", type_="check")
    op.drop_constraint("ck_vendor_phone", "vendors", type_="check")
    op.drop_constraint("ck_vendor_phoneNo_length", "vendors", type_="check")
    op.alter_column("vendors", "phoneNo", existing_type=sa.String(15), type_=sa.String(10))
    op.create_check_constraint("ck_vendor_phoneNo_length", "vendors",
                               'length("phoneNo") BETWEEN 1 AND 10 AND "phoneNo" = btrim("phoneNo")')
    op.create_check_constraint("ck_vendor_phone", "vendors", LEGACY_PHONE)
