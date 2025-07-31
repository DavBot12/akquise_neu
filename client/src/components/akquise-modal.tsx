import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle, XCircle } from "lucide-react";

interface AkquiseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (status: "erfolg" | "nicht_erfolgreich", notes?: string) => void;
  listingTitle: string;
}

export function AkquiseModal({ isOpen, onClose, onSubmit, listingTitle }: AkquiseModalProps) {
  const [selectedStatus, setSelectedStatus] = useState<"erfolg" | "nicht_erfolgreich" | null>(null);
  const [notes, setNotes] = useState("");

  const handleSubmit = () => {
    if (selectedStatus) {
      onSubmit(selectedStatus, notes);
      setSelectedStatus(null);
      setNotes("");
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Akquise abschließen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-3">
              Wie ist die Akquise für "{listingTitle}" verlaufen?
            </p>
            
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant={selectedStatus === "erfolg" ? "default" : "outline"}
                onClick={() => setSelectedStatus("erfolg")}
                className="flex items-center gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                Erfolgreich
              </Button>
              
              <Button
                variant={selectedStatus === "nicht_erfolgreich" ? "default" : "outline"}
                onClick={() => setSelectedStatus("nicht_erfolgreich")}
                className="flex items-center gap-2"
              >
                <XCircle className="h-4 w-4" />
                Nicht erfolgreich
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notizen (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Zusätzliche Informationen zur Akquise..."
              className="mt-1"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={!selectedStatus}
            >
              Bestätigen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}