import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Mail, Phone, Edit, Trash2, StickyNote } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import type { Contact } from "@shared/schema";

interface ContactCardProps {
  contact: Contact;
  onEdit: (contact: Contact) => void;
}

export default function ContactCard({ contact, onEdit }: ContactCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteContactMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: "Kontakt gelöscht",
        description: "Der Kontakt wurde erfolgreich gelöscht.",
      });
    },
    onError: () => {
      toast({
        title: "Fehler",
        description: "Kontakt konnte nicht gelöscht werden.",
        variant: "destructive",
      });
    },
  });

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map(n => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const handleDelete = () => {
    if (confirm(`Möchten Sie den Kontakt "${contact.name}" wirklich löschen?`)) {
      deleteContactMutation.mutate(contact.id);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary text-white font-semibold">
                {getInitials(contact.name)}
              </AvatarFallback>
            </Avatar>
            <div className="ml-4">
              <h3 className="font-semibold text-lg text-gray-800">{contact.name}</h3>
              {contact.company && (
                <p className="text-gray-600">{contact.company}</p>
              )}
            </div>
          </div>
          <div className="flex space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(contact)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleteContactMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <div className="space-y-3">
          {contact.email && (
            <div className="flex items-center">
              <Mail className="w-5 h-5 text-gray-400 mr-3" />
              <a 
                href={`mailto:${contact.email}`} 
                className="text-primary hover:underline"
              >
                {contact.email}
              </a>
            </div>
          )}
          {contact.phone && (
            <div className="flex items-center">
              <Phone className="w-5 h-5 text-gray-400 mr-3" />
              <a 
                href={`tel:${contact.phone}`} 
                className="text-primary hover:underline"
              >
                {contact.phone}
              </a>
            </div>
          )}
          {contact.notes && (
            <div className="flex items-start">
              <StickyNote className="w-5 h-5 text-gray-400 mr-3 mt-1" />
              <p className="text-gray-600 text-sm">{contact.notes}</p>
            </div>
          )}
        </div>
        
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Zugewiesene Listings:</span>
            <span className="font-medium">0</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
