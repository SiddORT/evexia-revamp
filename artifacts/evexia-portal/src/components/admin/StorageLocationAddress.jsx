import { lookupLocationPIN } from '../../services/serverLocations.js';
import useAddressSelection from './useAddressSelection.js';
import { GeographyControl, PostalSelection, useAddressCatalogue } from './AddressGeography.jsx';

export default function StorageLocationAddress({ values, errors, onChange, onChoiceRequired, disabled, editing }) {
  const address = useAddressSelection({ values, onChange, lookupPIN: lookupLocationPIN,
    editing, disabled, countryCodes: true, onChoiceRequired });
  const catalogue = useAddressCatalogue(address);
  return <>
    <p id="storage-geography-guidance" className="admin-storage-form__geography-guidance">
      Geography is optional for legacy records. Incomplete addresses require explicit PO destination selection.
    </p>
    <div className="mr-form__field mr-form__field--wide">
      <label className="mr-form__label" htmlFor="storage-pincode">PIN / Postal code</label>
      <input id="storage-pincode" name="pincode" className="mr-form__control" value={values.pincode || ''}
        disabled={disabled} maxLength={20} autoComplete="postal-code" placeholder="Six-digit PIN for India"
        aria-invalid={Boolean(errors.pincode)}
        aria-describedby={`storage-geography-guidance${address.postal.message ? ' storage-pin-feedback' : ''}${errors.pincode ? ' storage-pincode-error' : ''}`}
        onChange={(event) => address.change('pincode', event.target.value)} />
      {errors.pincode && <p id="storage-pincode-error" className="mr-form__error" role="alert">{errors.pincode}</p>}
    </div>
    <PostalSelection address={address} prefix="storage" />
    {[['countryCode', 'Country'], ['state', 'State/UT'], ['city', 'City']].map(([field, label]) =>
      <div className="mr-form__field" key={field}>
        <label className="mr-form__label" htmlFor={`storage-${field}`}>{label}</label>
        <GeographyControl address={address} catalogue={catalogue} field={field} id={`storage-${field}`}
          label={label} invalid={Boolean(errors[field])} describedBy={errors[field] ? `storage-${field}-error` : undefined} />
        {errors[field] && <p id={`storage-${field}-error`} className="mr-form__error" role="alert">{errors[field]}</p>}
      </div>)}
  </>;
}
