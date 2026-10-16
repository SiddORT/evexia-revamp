"""Frozen PostgreSQL 17 fresh-install catalog projections, not current ORM guesses.

Digests exclude data, OIDs, role names, and extension-owned implementation objects.
They include application DDL and all public object names, including unexpected
functions/types/operators. Regeneration is a release review, never a runtime step.
"""
import hashlib
import json

from sqlalchemy import text


def projection(connection):
    if connection.dialect.server_version_info[0] != 17:
        raise ValueError("Fresh catalog review requires PostgreSQL 17.")
    queries = {
        "namespace_objects": """
          SELECT DISTINCT i.type,i.identity
          FROM pg_depend d
          CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) i
          WHERE d.refclassid='pg_namespace'::regclass
            AND d.refobjid='public'::regnamespace ORDER BY i.type,i.identity
        """,
        "relations": """
          SELECT c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
                 c.relreplident,c.reloptions, obj_description(c.oid,'pg_class')
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' ORDER BY c.relname
        """,
        "columns": """
          SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
                 a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
                 col_description(c.oid,a.attnum)
          FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
          WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
            AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum
        """,
        "constraints": """
          SELECT c.relname,k.conname,pg_get_constraintdef(k.oid),k.convalidated
          FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' ORDER BY c.relname,k.conname
        """,
        "indexes": """
          SELECT c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready
          FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' ORDER BY c.relname
        """,
        "triggers": """
          SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled
          FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname
        """,
        "functions": """
          SELECT p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid)
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND NOT EXISTS(
            SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass
              AND d.objid=p.oid AND d.deptype='e')
          ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)
        """,
        "types": """
          SELECT t.typname,t.typtype,format_type(t.typbasetype,t.typtypmod),t.typnotnull,t.typdefault
          FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname='public' ORDER BY t.typname
        """,
        "other_objects": """
          SELECT 'operator',o.oprname,format_type(o.oprleft,NULL),format_type(o.oprright,NULL)
            FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public'
          UNION ALL SELECT 'collation',c.collname,c.collprovider::text,c.collcollate
            FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public'
          UNION ALL SELECT 'conversion',c.conname,c.conforencoding::text,c.contoencoding::text
            FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'
          UNION ALL SELECT 'policy',p.polname,c.relname,pg_get_expr(p.polqual,p.polrelid)
            FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
          UNION ALL SELECT 'rule',r.rulename,c.relname,pg_get_ruledef(r.oid)
            FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
          ORDER BY 1,2,3,4
        """,
        "sequences": """
          SELECT c.relname,format_type(s.seqtypid,NULL),s.seqstart,s.seqincrement,
                 s.seqmax,s.seqmin,s.seqcache,s.seqcycle
          FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' ORDER BY c.relname
        """,
    }
    return {name: [list(row) for row in connection.execute(text(sql))]
            for name, sql in queries.items()}


def digest(connection):
    return hashlib.sha256(json.dumps(projection(connection), sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()
