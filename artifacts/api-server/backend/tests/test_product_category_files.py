import io
import zipfile
import pytest
from app.services import product_category_transfer as transfer
from app.services.product_categories import ProductCategoryError
from test_zones import workbook, replace_zip
from test_sessions import client
from test_reporting import admin_headers
from test_product_categories import BASE, add, review

@pytest.mark.parametrize("data,filename", [
    (b"not a workbook", "hq.xlsx"), (b"Product Category Name,Description,Unit Price,Status,id\nX,X,0,active,1", "hq.csv"),
    (b"\xff\xfe", "hq.csv"), (b"Product Category Name,Description,Unit Price,Status\nX,X,0,active", "hq.xls"),
    (b"Product Category Name,Description,Unit Price,Status\nX,X,0,active", "hq.xlsm"),
    (b"Product Category Name,Description,Unit Price,Status\n" + b"X,X,0,active\n" * 1001, "hq.csv"),
    (b"x" * (transfer.MAX_BYTES + 1), "hq.csv"),
    (b'Product Category Name,Description,Unit Price,Status\n"unclosed,X,active', "hq.csv"),
])
def test_parser_bounds(data, filename):
    with pytest.raises(ProductCategoryError):
        transfer.parse(data, filename)


def test_workbook_formulas_links_archives_and_cell_bounds():
    def with_member(name, content):
        output = io.BytesIO(workbook([transfer.HEADERS[:4], ["X", "X", "0", "active"]]))
        with zipfile.ZipFile(output, "a") as archive:
            archive.writestr(name, content)
        return output.getvalue()
    for data in (
        workbook([transfer.HEADERS[:4], ["=1+1", "X", "0", "active"]]),
        workbook([transfer.HEADERS[:4], ["x" * 10001, "X", "0", "active"]]),
        with_member("xl/externalLinks/externalLink1.xml", b"<x/>"),
        with_member("xl/vbaProject.bin", b"macro"),
        with_member("xl/bomb.xml", b"x" * (4 * 1024 * 1024 + 1)),
        replace_zip(workbook([transfer.HEADERS[:4], ["X", "X", "0", "active"]]), "xl/worksheets/sheet1.xml",
                    lambda data: data.replace(b'r="A2"', b'r="A1002"')),
    ):
        with pytest.raises(ProductCategoryError):
            transfer.parse(data, "hq.xlsx")


def test_multipart_overhead_raw_limits_and_export_bound(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    data = b"Product Category Name,Description,Unit Price,Status\nMultipart,,0,active"
    response = api.post(BASE + "/import/review", headers=headers, params={"filename": "hq.csv"},
                        files={"file": ("hq.csv", data, "text/csv")})
    assert response.status_code == 200 and response.json()["valid"]
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "hq.csv"},
                    files={"file": ("hq.csv", data)}, data={"unexpected": "field"}).status_code == 422
    assert review(api, headers, b"x" * (transfer.MAX_BYTES + 1)).status_code == 413
    assert api.post(BASE + "/import/review", headers={**headers, "Content-Type": "multipart/form-data; boundary=x"},
                    params={"filename": "hq.csv"}, content=b"x" * (transfer.MAX_BYTES + 65537)).status_code == 413
    add(api, headers, "One")
    add(api, headers, "Two")
    monkeypatch.setattr(transfer, "EXPORT_LIMIT", 1)
    assert api.get(BASE + "/export", headers=headers).status_code == 422
    assert api.get(BASE + "/export", headers=headers, params={"query": "One"}).status_code == 200
