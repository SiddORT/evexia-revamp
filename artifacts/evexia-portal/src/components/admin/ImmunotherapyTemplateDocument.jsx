import '../../immunotherapyTemplateDocument.css';

const logoUrl = `${import.meta.env.BASE_URL}images/evexia-logo.png`;

const EN = [
  'Drops should be taken at a fixed time, preferably early in the morning.',
  'They should be placed below the tongue, wait for 2 minutes and then swallow.',
  'Patient should not eat or drink anything 30 minutes before and after taking the vaccines.',
  'Kindly keep the vaccines in the fridge. Shake well before use, keep the bottle upright to prevent spillage.',
  'If there is any itching or tickling in the throat, drink half a cup of cold water.',
  'Kindly contact 15 days in advance for the next booster dosage.',
  'And also follow up with the attending doctor at least once in 3 months.',
  'If Patient has increased symptoms of allergy, the dose may need adjustment please see your Doctor.',
  'You Must consent the treating Doctors every 3 months',
  'Kindly inform SOS if any doubt or clarification',
];
const HI = [
  'सुबह में बूंदों को एक निश्चित समय पर लिया जाना चाहिए।',
  'उन्हें जीभ के नीचे रखा जाना चाहिए, 2 मिनट तक प्रतीक्षा करें और फिर निगल लें।',
  'दवाई लेने के 30 मिनट पहले और बाद में रोगी को कुछ भी नहीं खाना या पीना चाहिए।',
  'कृपया दवाई को फ्रिज में रखें, उपयोग करने से पहले अच्छी तरह से हिलाएं, को छलकाव रोकने के लिए बोतल को सीधा रखें।',
  'गले में कोई खुजली या गुदगुदी हो तो आधा कप ठंडा पानी पिएं।',
  'अगले बूस्टर डोजेज के लिए कृपया 15 दिन पहले संपर्क करें।',
  'और 3 महीने में कम से कम एक बार उपस्थित चिकित्सक के साथ भी पालन करें।',
  'यदि रोगी में एलर्जी के लक्षण बढ़ गए हैं, रोगी को समायोजन की आवश्यकता है कृपया अपने डॉक्टर को संपर्क करें।',
  'आपको हर 3 महीने में इलाज करने वाले डॉक्टरों की सहमति लेनी चाहिए।',
  'किसी भी संदेह या स्पष्टीकरण के लिए कृपया एसओएस को सूचित करें।',
];
const WEEKS = [['2', '4'], ['6', '8'], ['10', '10'], ['10', '10'], ['10', '10']];
const CAPTIONS = [
  null,
  ['AFTER FINISHING 1ST BOTTLE START BOTTLE NO 2ND', 'बोतल नं. 1 के बाद बोतल नं. 2 शुरू करें'],
  ['AFTER FINISHING 2ND BOTTLE START BOTTLE NO 3RD', 'बोतल नं. 2 के बाद बोतल नं.3 शुरू करें'],
  ['AFTER FINISHING 3RD BOTTLE START BOTTLE NO 4TH', 'बोतल नं. 3 के बाद बोतल नं.4 शुरू करें'],
];

function Brand({ tagline }) {
  return <div className="po-doc__brand">
    {tagline && <span className="po-doc__tagline">IMPROVING IMMUNITY</span>}
    <img className="po-doc__logo" src={logoUrl} alt="Evexia Life Sciences" />
    {tagline && <span className="po-doc__ce">CE</span>}
  </div>;
}

function Sample({ m }) {
  return m.isSample ? <p className="po-doc__sample">SAMPLE ONLY - NOT A CLINICAL OR FINANCIAL DOCUMENT</p> : null;
}

function BottleTable({ n }) {
  const cap = CAPTIONS[n - 1];
  return <div className="po-doc__bottle">
    {cap && <div className="po-doc__cap"><p>{cap[0]}</p><p lang="hi">{cap[1]}</p></div>}
    <table>
      <tbody>
        {n === 1 && <tr><th>DAY</th>{[1, 2, 3, 4, 5].map((w) => <th key={w}>WEEK {w}</th>)}<td rowSpan="2" className="po-doc__till"><b>TILL BOTTLE NO - 1 IS OVER</b></td></tr>}
        <tr><th>{n === 1 ? 'BOTTLE NO -1' : `BOTTLE NO -${n}`}</th>{WEEKS.map((_, i) => <th key={i}>BOTTLE NO -{n}</th>)}
          {n !== 1 && <td rowSpan="2" className="po-doc__till"><b>TILL BOTTLE NO - {n} IS OVER</b></td>}</tr>
        <tr><th>MONDAY (<span lang="hi">सोमवार</span>)</th>{WEEKS.map((w, i) => <td key={i}><b>{w[0]} drops</b></td>)}
          {n === 1 && <td rowSpan="2" className="po-doc__till po-doc__till--hi" lang="hi"><b>बोतल नं. 1 खत्म होने तक</b></td>}</tr>
        <tr><th>THURSDAY (<span lang="hi">गुरुवार</span>)</th>{WEEKS.map((w, i) => <td key={i}><b>{w[1]} drops</b></td>)}
          {n !== 1 && <td className="po-doc__till" lang="hi"><b>बोतल नं. {n} खत्म होने तक</b></td>}</tr>
      </tbody>
    </table>
  </div>;
}

function Instructions({ m }) {
  return <div className="po-doc__page po-doc__page--instr">
    <Sample m={m} />
    <div className="po-doc__center"><Brand tagline /></div>
    <p className="po-doc__bar">SCHEDULE FOR DOUBLE DILUTION (DD)</p>
    <ul className="po-doc__list">{EN.map((t) => <li key={t}>{t}</li>)}</ul>
    <ul className="po-doc__list" lang="hi">{HI.map((t) => <li key={t}>{t}</li>)}</ul>
    <p className="po-doc__freeze">DO NOT FREEZE</p>
    <p className="po-doc__bar">BOX NO. 1 A</p>
    {[1, 2, 3, 4].map((n) => <BottleTable key={n} n={n} />)}
    <footer className="po-doc__foot">
      <p>Regd. Office : Laud Mansion, 21 Queen's Road, Charni Road, Mumbai-400 004</p>
      <p>Email: info@evexialifesciences.com Tel: +91 8655854797</p>
      <p>Website: www.evexialifesciences.com / www.allergyworld.in</p>
    </footer>
  </div>;
}

function Letter({ m }) {
  return <div className="po-doc__page po-doc__page--letter">
    <Sample m={m} />
    <div className="po-doc__center">
      <Brand />
      <p>Laud Mansion,21 Queen's Road,Charni Road, Mumbai-400004</p>
      <p>Email: info@evexialifesciences.com/ Cell: 8655854797</p>
      <p>CIN: U24233MH2015PTC269536</p>
    </div>
    <p className="po-doc__date">{m.date}</p>
    <h2 className="po-doc__title">TO WHOM SO EVER IT MAY CONCERN</h2>
    <p>This is to confirm that this Box contains vaccines (protein extract) for specific allergen for which patient is allergic to, and the duration of the vaccines is 18 to 24 months.</p>
    <p>Patient Name: {m.patientName}</p>
    <p>Doctor Name: {m.doctorName}</p>
    <p>Dose- {m.dose}</p>
    <p>Allergens:</p>
    <p>1. Dust Mites : {m.allergen}</p>
    <div className="po-doc__auth">
      <p className="po-doc__authlabel">Authorized Signatory</p>
      <div className="po-doc__unsigned">UNSIGNED SAMPLE - signature and seal intentionally omitted</div>
      <p className="po-doc__authco">Evexia Life Sciences Pvt. Ltd.</p>
    </div>
  </div>;
}

function ShipPanel({ m }) {
  return <div className="po-doc__ship">
    <div className="po-doc__shipTop">
      <p>TO,</p>
      <p>{m.recipientName}</p>
      {m.recipientAddress.map((l) => <p key={l}>{l}</p>)}
      <p>CONTACT NO :- {m.recipientContact}</p>
      <p>&nbsp;</p>
      <p>FROM,</p>
      <p>EVEXIA LIFE SCIENCES</p>
      <p>LAUD MANSION,21,QUEEN RD,</p>
      <p>OPPOSITE CHARNI ROAD RAILWAY STN</p>
      <p>MUMBAI(MAHARASHTRA)400004</p>
    </div>
    <div className="po-doc__shipBot">
      <p>CHECKED BY {m.checkedBy}</p>
      <p>CONTACT NO :- {m.checkerContact}</p>
      <p>SIGN - <span className="po-doc__blank">(unsigned sample)</span></p>
    </div>
  </div>;
}

function Shipping({ m, fullSheet, sheet }) {
  if (!fullSheet) return <div className="po-doc__page po-doc__page--ship"><Sample m={m} /><ShipPanel m={m} /></div>;
  const ratio = sheet && sheet.width && sheet.height ? `${sheet.width} / ${sheet.height}` : '595 / 842';
  return <div className="po-doc__page po-doc__page--ship"><Sample m={m} />
    <div className="po-doc__sheet" style={{ aspectRatio: ratio }}><ShipPanel m={m} /></div></div>;
}

function Box({ title, children }) {
  return <section className="po-doc__ibox"><h3>{title}</h3><div>{children}</div></section>;
}

function Invoice({ m }) {
  const f = m.figures;
  return <div className="po-doc__page po-doc__page--inv">
    <Sample m={m} />
    <header className="po-doc__ihead">
      <Brand tagline />
      <div>
        <p><b>EVEXIA LIFE SCIENCES PVT. LTD.</b></p>
        <p>2nd FLOOR, LAUD MANSION, 21,QUEEN ROAD, MUMBAI, Mumbai City, Maharashtra, 400004</p>
        <p>GSTIN: SAMPLE-NOT-REGISTERED</p>
        <p>info@evexialifesciences.com / www.evexialifesciences.com</p>
        <p>Customer Care No: +91 86558 54797</p>
      </div>
    </header>
    <div className="po-doc__iboxes">
      <Box title="Billed To Doctor Details">
        <p><b>Name: {m.doctorName}</b></p>
        <p><b>Address:</b> {m.doctorAddress.join(', ')}</p>
        <p><b>City:</b> Sample City</p>
        <p><b>State:</b> Sample State</p>
        <p><b>Contact Details:</b> Not provided (sample)</p>
        <p><b>Email:</b> Not provided (sample)</p>
        <p><b>GSTIN/UNIQUE ID:</b> Not provided (sample)</p>
      </Box>
      <Box title="Patient Details">
        <p><b>Name: {m.patientName}</b></p>
        <p><b>Address:</b> {m.patientAddress.join(', ')}</p>
        <p><b>City:</b> Sample City</p>
        <p><b>State:</b> Sample State</p>
        <p><b>Contact Details:</b> -</p>
        <p><b>Email:</b> -</p>
      </Box>
      <Box title="Invoice Details">
        <p><b>Invoice No: {m.invoiceNumber}</b></p>
        <p><b>Order No: {m.orderNumber}</b></p>
        <p><b>Invoice Date: {m.invoiceDate}</b></p>
        <p><b>Date of supply: {m.supplyDate}</b></p>
        <p><b>Mode of transport: Courier (sample)</b></p>
      </Box>
    </div>
    <section className="po-doc__items">
      <h3>Finish Product :- Primary</h3>
      <table className="po-doc__itbl">
        <thead><tr><th>Sr No.</th><th>Product Description</th><th>HSN Code</th><th>Batch No</th><th>Taxable Value(In Rs)</th></tr></thead>
        <tbody>{m.items.map((it, i) => <tr key={it.batch}><td>{i + 1}</td><td>{it.description}</td><td>{it.hsn}</td><td>{it.batch}</td><td className="po-doc__num">{it.taxable}</td></tr>)}</tbody>
      </table>
      <table className="po-doc__ftbl"><tbody>
        <tr><th>Discount:(₹)</th><td>{f.discount}</td></tr>
        <tr><th>Total Amount Before Tax</th><td>{f.beforeTax}</td></tr>
        <tr><th>{f.taxLabel}</th><td>{f.tax}</td></tr>
        <tr><th>Less/Add: Round Off</th><td>{f.roundOff}</td></tr>
        <tr><th>Total Amount After Tax</th><td>{f.total}</td></tr>
      </tbody></table>
      <p className="po-doc__words"><b>Amount in words : {f.words}</b></p>
    </section>
    <section className="po-doc__pay">
      <div className="po-doc__bank">
        <p>Drug License No: SAMPLE-LIC-000 (placeholder)</p>
        <p><b>Bank Details</b> (SAMPLE - nonfunctional placeholders)</p>
        <p>Bank Name: SAMPLE BANK NAME</p>
        <p>A/c No: SAMPLE-ACCOUNT-NOT-VALID</p>
        <p>Branch: Sample Branch</p>
        <p>IFSC Code: SAMP0000000 (sample)</p>
        <p>PAN No: SAMPLE0000X (sample)</p>
        <p>Payment on: Not provided (sample)</p>
        <p>UPI ID: NOT-A-PAYMENT-ID (SAMPLE)</p>
        <div className="po-doc__qr"><div>QR PLACEHOLDER<br />not a real QR code</div><p>Scan to pay with any UPI App (disabled in sample)</p></div>
      </div>
      <div className="po-doc__sign">
        <p>For Evexia Life Sciences Pvt. Ltd.</p>
        <div className="po-doc__unsigned">UNSIGNED SAMPLE</div>
        <p>Authorised Signatory</p>
      </div>
    </section>
    <section className="po-doc__terms">
      <p><b>Declaration :</b></p>
      <p>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct</p>
      <p><b>TERMS OF SALE :</b></p>
      <p><b>1] Goods once sold will not be taken back or exchanged.</b></p>
      <p><b>2] Seller is not responsible for any loss or damaged of goods in transit.</b></p>
      <p><b>3] Buyer undertakes to submit prescribed GST declaration to sender on demand. Disputes if any will be subject to seller court jurisdiction.</b></p>
      <p><b>4] Interest @18%p.a. will be charged if the payment is not made within 21 days of delivery date.</b></p>
      <p><b>5] Cheque Return will be charged Rs.300/- Extra.</b></p>
    </section>
  </div>;
}

const LABELS = {
  instructions: 'Immunotherapy instructions and dosing schedule sample',
  'abroad-letter': 'Abroad travel letter sample',
  'shipping-address': 'Shipping address sheet sample',
  'immunotherapy-invoice': 'Immunotherapy invoice sample',
};

export default function ImmunotherapyTemplateDocument({ document, compact = false, fullSheet = false }) {
  if (!document || !document.model) return null;
  const { type, model: m, templateId, sourceSheet } = document;
  if (!LABELS[type]) return <p role="alert">Unsupported immunotherapy document type.</p>;
  return <article className={`po-doc po-doc--${type}${compact ? ' po-doc--compact' : ''}`} data-template-id={templateId} aria-label={LABELS[type]}>
    {type === 'instructions' && <Instructions m={m} />}
    {type === 'abroad-letter' && <Letter m={m} />}
    {type === 'shipping-address' && <Shipping m={m} fullSheet={fullSheet} sheet={sourceSheet} />}
    {type === 'immunotherapy-invoice' && <Invoice m={m} />}
  </article>;
}
