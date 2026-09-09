# EDC Case Sitemaps

Language for selecting EDC property listing URLs and presenting them in XML sitemaps.

## Language

**Case**:
A property listing identified by an EDC case number.

**Case URL**:
The URL of a particular property listing, including its case number where present in the supplied listing path.

**BBR URL**:
The property-level URL under `/alle-boliger/`, without the listing's trailing case-number segment. In this project, this term describes a URL form, not a separate source of BBR records.

**Input page**:
A page of case records requested from EDC's quick-search service.

**Output URL limit**:
The requested maximum number of URLs in a sitemap when no age window is supplied.

**Publication date**:
The case's `statusChangeDate`, which this project uses as the date of publication.

**Age window**:
A rolling period measured from publication date that selects eligible cases within the chosen input page. It replaces the output URL limit when supplied.
