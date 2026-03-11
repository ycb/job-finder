import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/components/ui/use-toast";

const rows = [
  { source: "LinkedIn", status: "Enabled", cadence: "Daily" },
  { source: "Indeed", status: "Enabled", cadence: "Daily" },
  { source: "Google Jobs", status: "Disabled", cadence: "Manual" },
];

export default function App() {
  const { toast } = useToast();

  return (
    <main className="container px-4 py-8 md:py-10">
      <Card className="animate-fade-in">
        <CardHeader className="space-y-3">
          <CardTitle>Dashboard Design System Foundation</CardTitle>
          <CardDescription>
            Tailwind + shadcn-compatible primitives for the React Searches migration lane.
          </CardDescription>
          <Tabs defaultValue="enabled" className="w-full">
            <TabsList>
              <TabsTrigger value="enabled">Enabled Searches</TabsTrigger>
              <TabsTrigger value="disabled">Disabled Searches</TabsTrigger>
            </TabsList>

            <TabsContent value="enabled">
              <Card className="mt-4 border-dashed bg-secondary/20">
                <CardContent className="space-y-4 pt-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <Select defaultValue="daily">
                      <SelectTrigger className="w-full md:w-56">
                        <SelectValue placeholder="Select cadence" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Run cadence</SelectLabel>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="twice-weekly">Twice weekly</SelectItem>
                          <SelectItem value="manual">Manual</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() =>
                        toast({
                          title: "Searches welcome toast",
                          description:
                            "Primitive toast surface is active and ready for first-visit logic.",
                        })
                      }
                    >
                      Trigger Toast
                    </Button>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Cadence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.source}>
                          <TableCell className="font-medium">{row.source}</TableCell>
                          <TableCell>{row.status}</TableCell>
                          <TableCell>{row.cadence}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="disabled">
              <Card className="mt-4 border-dashed bg-secondary/20">
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">
                    Disabled tab confirms active/inactive trigger semantics where active tabs are rendered
                    with the dark accent token.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardHeader>
      </Card>

      <Toaster />
    </main>
  );
}
