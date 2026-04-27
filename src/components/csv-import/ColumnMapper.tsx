import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const DB_COLUMNS = [
  { value: "__skip__", label: "— Skip —" },
  { value: "shareholder_name", label: "Shareholder Name" },
  { value: "shareholder_type", label: "Type (person/org)" },
  { value: "birth_year", label: "Birth Year" },
  { value: "gender", label: "Gender" },
  { value: "municipality", label: "Municipality" },
  { value: "postcode", label: "Postcode" },
  { value: "orgnr", label: "Org Number" },
  { value: "company_name", label: "Company Name" },
  { value: "shares", label: "Shares" },
  { value: "year", label: "Year" },
];

// Auto-detect mapping based on CSV header names
function autoMap(csvHeaders: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const patterns: Record<string, RegExp> = {
    shareholder_name: /^(name|shareholder.*name|aksjonær|navn)/i,
    shareholder_type: /^(type|shareholder.*type|aksjonær.*type)/i,
    birth_year: /^(birth.*year|fødselsår|birth)/i,
    gender: /^(gender|kjønn|sex)/i,
    municipality: /^(municipality|kommune|muni)/i,
    postcode: /^(post.*code|postnr|postnummer|zip)/i,
    orgnr: /^(org.*n|orgnr|org.*number|organisasjon)/i,
    company_name: /^(company.*name|selskap|firma|company)/i,
    shares: /^(shares|aksjer|antall.*aksjer|antal)/i,
    year: /^(year|år|dato.*år)/i,
  };

  for (const header of csvHeaders) {
    let matched = false;
    for (const [dbCol, regex] of Object.entries(patterns)) {
      if (regex.test(header.trim())) {
        mapping[header] = dbCol;
        matched = true;
        break;
      }
    }
    if (!matched) mapping[header] = "__skip__";
  }
  return mapping;
}

interface ColumnMapperProps {
  csvHeaders: string[];
  previewRows: string[][];
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
}

export { autoMap };

export function ColumnMapper({ csvHeaders, previewRows, mapping, onMappingChange }: ColumnMapperProps) {
  const setColumn = (csvCol: string, dbCol: string) => {
    onMappingChange({ ...mapping, [csvCol]: dbCol });
  };

  const mappedCount = Object.values(mapping).filter((v) => v !== "__skip__").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-foreground">Column Mapping</h3>
        <Badge variant="secondary">{mappedCount} mapped</Badge>
      </div>
      <div className="rounded-lg border overflow-auto max-h-[400px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">CSV Column</TableHead>
              <TableHead className="w-[200px]">Maps To</TableHead>
              <TableHead>Preview (first 3 rows)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {csvHeaders.map((header, i) => (
              <TableRow key={header}>
                <TableCell className="font-mono text-sm">{header}</TableCell>
                <TableCell>
                  <Select value={mapping[header] || "__skip__"} onValueChange={(v) => setColumn(header, v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DB_COLUMNS.map((col) => (
                        <SelectItem key={col.value} value={col.value}>{col.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground font-mono">
                  {previewRows.slice(0, 3).map((row) => row[i] ?? "").join(" | ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
