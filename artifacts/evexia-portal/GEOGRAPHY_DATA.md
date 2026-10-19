# Address geography data

The address selectors use **country-state-city 3.2.1** by **Harpreet Singh**
and its contributors, from
https://github.com/harpreetkhalsagtbit/country-state-city.
The package and its data are distributed under **GPL-3.0**:
https://www.gnu.org/licenses/gpl-3.0.html.
The complete license is retained in the installed package's LICENSE file.
The city field also links to a copy of that license included as a build asset.
Upstream credits its geographical data source at
https://github.com/dr5hn/countries-states-cities-database.

Country, state and city JSON files are loaded in separate on-demand chunks.
No address or PIN is sent to the dataset publisher. PIN requests continue to
use the existing authenticated master-specific India Post adapters.

The catalogue is not an authoritative postal directory. Saved spellings and
valid India Post results may differ and must not be silently replaced.

## Compatibility and verification

Only Storage Location submits an ISO country code; MR, Patient and Doctor
continue to submit country names. Indian state aliases map to the established
State/UT names. No saved address is rewritten just by opening an edit form.
All existing master validation remains in place, including MR's existing
six-digit PIN rule and Storage Location's supported-country and Indian-state
validation. Foreign country selection does not trigger India Post requests.

Verification for this change is limited to source review. No tests, builds,
browser scripts, release gates, or runtime checks were run. Actual rendering,
keyboard interaction, catalogue downloads and PIN requests remain untested.
