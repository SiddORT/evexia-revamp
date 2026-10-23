import '../../labelTemplateDocument.css';

const logoUrl = `${import.meta.env.BASE_URL}images/evexia-logo.png`;

function Arrow({ x }) {
  return <path transform={`translate(${x} 0)`} d="M26 0 L52 30 L38 30 L38 62 L14 62 L14 30 L0 30 Z" fill="#fff" stroke="#000" strokeWidth="3" />;
}

function BoxLabel({ m }) {
  const rows = [['Patient Name', m.patientName], ['Doctor Name', m.doctorName], ['Order Date', m.orderDate], ['Order Number', m.orderNumber]];
  const ys = [225, 265, 306, 336];
  return <svg className="label-document__svg" viewBox="40 26 910 548" aria-hidden="true" focusable="false">
    <rect x="0" y="0" width="950" height="580" fill="#fff" />
    <rect x="46" y="32" width="898" height="536" fill="none" stroke="#000" strokeWidth="5" />
    <text x="163" y="95" textAnchor="middle" fontSize="25" fontWeight="700">URGENT</text>
    <rect x="59" y="107" width="210" height="55" fill="none" stroke="#000" strokeWidth="1.5" />
    <text x="135" y="131" textAnchor="middle" fontSize="16" fontWeight="700">On Reciept Store</text>
    <text x="135" y="150" textAnchor="middle" fontSize="16" fontWeight="700">at</text>
    <path d="M240 122 V145 M216 150 H264" stroke="#000" strokeWidth="1.5" fill="none" />
    <text x="248" y="128" fontSize="7">8°C</text><text x="216" y="147" fontSize="7">4°C</text>
    <image href={logoUrl} x="345" y="55" width="300" height="105" preserveAspectRatio="xMidYMid meet" />
    <text x="360" y="157" fontSize="26" fontWeight="500">CE</text>
    <g transform="translate(782 73)"><Arrow x={0} /><Arrow x={62} /></g>
    <line x1="290" y1="166" x2="695" y2="166" stroke="#000" strokeWidth="2" />
    <line x1="290" y1="198" x2="695" y2="198" stroke="#000" strokeWidth="2" />
    <text x="492" y="191" textAnchor="middle" fontSize="23" fontWeight="500">Double Dilution Dose</text>
    {rows.map(([k, v], i) => <g key={k}>
      <text x="295" y={ys[i]} fontSize="22" fontWeight="500">{k}</text>
      <text x="456" y={ys[i]} fontSize="22" fontWeight="500">- {v}</text></g>)}
    <text x="706" y="232" fontSize="17" fontWeight="500">ALLERGENS -</text>
    {m.allergens.map((a, i) => <text key={i} x="704" y={258 + i * 26} fontSize="22" fontWeight="500">{i + 1}. {a}</text>)}
    <path d="M291 370 H331 L311 395 L331 420 H291 L311 395 Z" fill="#000" />
    <rect x="291" y="368" width="40" height="52" fill="none" stroke="#000" strokeWidth="3" />
    <line x1="376" y1="418" x2="468" y2="418" stroke="#000" strokeWidth="2" />
    <path d="M516 420 V398 L526 406 L536 398 L546 406 V392 H556 V420 Z" fill="none" stroke="#000" strokeWidth="2" />
    <line x1="600" y1="418" x2="692" y2="418" stroke="#000" strokeWidth="2" />
    <g fontSize="13" fontWeight="500">
      <text x="57" y="432" fontWeight="700">Evexia Life Sciences Pvt. Ltd.</text>
      <text x="57" y="450">Reg. off - 2nd Floor,</text>
      <text x="57" y="468">Laud Mansion, Mumbai - 400 004.</text>
      <text x="57" y="486">E-mail: info@evexialifesciences.com</text>
      <text x="57" y="504">Customer Care No.: +91 865854797</text>
    </g>
    <text x="321" y="464" fontSize="15">USE - Ready product Immune therapy from the Allergic</text>
    <text x="321" y="485" fontSize="15">Expert with method of Indian FDA</text>
    <line x1="46" y1="510" x2="944" y2="510" stroke="#000" strokeWidth="2" />
    <text x="495" y="541" textAnchor="middle" fontSize="22" fontWeight="500">HANDLE WITH CARE</text>
  </svg>;
}

function Vial({ v, m, x, y }) {
  const W = 800, H = 170;
  return <g transform={`translate(${x} ${y})`}>
    <rect x="2" y="2" width={W - 4} height={H - 4} fill="#fff" stroke="#000" strokeWidth="2" />
    <rect x="8" y="8" width="62" height={H - 16} fill={v.color} />
    <text x="39" y="42" textAnchor="middle" fontSize="20" fontWeight="700" className="label-document__white">Vial</text>
    <text x="39" y="125" textAnchor="middle" fontSize="72" fontWeight="700" className="label-document__white">{v.number}</text>
    <rect x="76" y="8" width="280" height={H - 16} fill={v.color} />
    <rect x="82" y="48" width="268" height="84" fill="#fff" />
    <text x="216" y="37" textAnchor="middle" fontSize="29" fontWeight="700" className="label-document__white">STALLERGO™</text>
    <text x="216" y="64" textAnchor="middle" fontSize="13" fontWeight="700">Aqueous Extract {v.volume}</text>
    <text x="216" y="78" textAnchor="middle" fontSize="9" fontWeight="700">{m.allergen}</text>
    <text x="87" y="112" fontSize="10">Dosage: As determined by the physician</text>
    <text x="87" y="125" fontSize="10">Storage: Store between +4°C &amp; +8°C</text>
    <text x="216" y="153" textAnchor="middle" fontSize="21" fontWeight="700" className="label-document__white">evexia life sciences</text>
    <rect x="362" y="8" width="44" height="154" fill="none" stroke="#000" />
    <g transform="translate(364 158) rotate(-90)" fontSize="11">
      <text x="0" y="9" fontWeight="500">Warning: To be supplied</text>
      <text x="0" y="23">only against prescription</text>
      <text x="0" y="37">from a specialist</text>
    </g>
    <g transform="translate(410 158) rotate(-90)" fontSize="11" fontWeight="700">
      <text x="0" y="9">Aqueous Allergen Extract</text>
      <text x="0" y="23">NOT FOR INJECTION</text>
      <text x="0" y="37">{v.strength}</text>
    </g>
    <g transform="translate(458 158) rotate(-90)" fontSize="8.5">
      <text x="0" y="10">Manufactured in India by:</text>
      <text x="0" y="23">CDM Pvt. Ltd.</text>
      <text x="0" y="36">D-296, Vashi Plaza, Sector 17,</text>
      <text x="0" y="49">Vashi, Navi Mumbai, 400705</text>
      <text x="0" y="62">At: Plot No. A-698, M.I.D.C.,</text>
      <text x="0" y="75">Mahape, Navi Mumbai</text>
      <text x="0" y="88">400710.</text>
      <text x="0" y="103" fontWeight="700">&quot;Shake well before use&quot;</text>
    </g>
    <g fontSize="11" fontWeight="500">
      <text x="577" y="23" fontWeight="700">Mfg. Lic. No. KD 2758A</text>
      <text x="577" y="39" lang="mr">उत्पादन परवाना क्रः</text>
      <text x="577" y="56" fontWeight="700">Batch No.</text>
      <text x="577" y="72"><tspan lang="hi">बैच नं. : </tspan>{m.batchNumber}</text>
      <text x="577" y="89" fontWeight="700">Mfg. Date</text>
      <text x="577" y="105"><tspan lang="hi">उत्पादन तिथि : </tspan>{m.manufactured}</text>
      <text x="577" y="122" fontWeight="700">Exp. Date</text>
      <text x="577" y="138"><tspan lang="hi">समाप्ति तिथि : </tspan>{m.expires}</text>
      <text x="577" y="157" fontWeight="700">OD NO. {m.orderNumber}</text>
    </g>
  </g>;
}

function BottleLabel({ m }) {
  return <svg className="label-document__svg" viewBox="0 0 1612 352" aria-hidden="true" focusable="false">
    <rect width="1612" height="352" fill="#fff" />
    {m.vials.map((v, i) => <Vial key={v.number} v={v} m={m} x={(i % 2) * 812} y={Math.floor(i / 2) * 182} />)}
  </svg>;
}

export default function LabelTemplateDocument({ document }) {
  if (!document || !document.model) return null;
  const { type, model: m, templateId } = document;
  if (type !== 'box' && type !== 'bottle') return <p role="alert">Unsupported label document type.</p>;
  const sample = m.isSample;
  return <div className="label-document" data-template-id={templateId}>
    {sample && <p className="label-document__sample">SAMPLE ONLY - NOT A PATIENT DOCUMENT</p>}
    <div role="img" aria-label={`${type === 'box' ? 'Box' : 'Bottle'} label sample`}>
      {type === 'box' ? <BoxLabel m={m} /> : <BottleLabel m={m} />}
    </div>
    <section className="label-document__sr" aria-label="Label text details">
      {sample && <p>Sample document, not a real patient label.</p>}
      {type === 'box' ? <>
        <p>URGENT. On Reciept Store at 4 to 8 C. Improving Immunity. Evexia Life Sciences. CE mark. Handle upright.</p>
        <p>Double Dilution Dose. Patient Name: {m.patientName}. Doctor Name: {m.doctorName}. Order Date: {m.orderDate}. Order Number: {m.orderNumber}.</p>
        <p>Allergens: {m.allergens.join('; ')}.</p>
        <p>USE - Ready product Immune therapy from the Allergic Expert with method of Indian FDA.</p>
        <p>Evexia Life Sciences Pvt. Ltd. Reg. off - 2nd Floor, Laud Mansion, Mumbai - 400 004. E-mail: info@evexialifesciences.com. Customer Care No.: +91 865854797. HANDLE WITH CARE.</p>
      </> : <>
        <p>STALLERGO TM. Allergen: {m.allergen}. Order {m.orderNumber}. Batch {m.batchNumber}. Manufactured {m.manufactured}. Expires {m.expires}. Mfg. Lic. No. KD 2758A.</p>
        <p>Warning: To be supplied only against prescription from a specialist. Aqueous Allergen Extract, NOT FOR INJECTION. Manufactured in India by: CDM Pvt. Ltd. D-296, Vashi Plaza, Sector 17, Vashi, Navi Mumbai, 400705. At: Plot No. A-698, M.I.D.C., Mahape, Navi Mumbai 400710. "Shake well before use". Dosage: As determined by the physician. Storage: Store between +4°C &amp; +8°C.</p>
        <ul>{m.vials.map((v) => <li key={v.number}>Vial {v.number}: Aqueous Extract {v.volume}, strength {v.strength}.</li>)}</ul>
      </>}
    </section>
  </div>;
}
