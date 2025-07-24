import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { insertContactSchema } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact?: any;
}

const contactFormSchema = insertContactSchema.extend({
  name: z.string().min(1, "Name ist erforderlich"),
});

export default function ContactModal({ isOpen, onClose, contact }: ContactModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof contactFormSchema>>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: "",
      company: "",
      email: "",
      phone: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (contact) {
      form.reset({
        name: contact.name || "",
        company: contact.company || "",
        email: contact.email || "",
        phone: contact.phone || "",
        notes: contact.notes || "",
      });
    } else {
      form.reset({
        name: "",
        company: "",
        email: "",
        phone: "",
        notes: "",
      });
    }
  }, [contact, form]);

  const createContactMutation = useMutation({
    mutationFn: async (data: any) => {
      if (contact) {
        return await apiRequest("PATCH", `/api/contacts/${contact.id}`, data);
      } else {
        return await apiRequest("POST", "/api/contacts", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: contact ? "Kontakt aktualisiert" : "Kontakt erstellt",
        description: contact 
          ? "Der Kontakt wurde erfolgreich aktualisiert." 
          : "Der neue Kontakt wurde erfolgreich erstellt.",
      });
      onClose();
    },
    onError: () => {
      toast({
        title: "Fehler",
        description: "Der Kontakt konnte nicht gespeichert werden.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof contactFormSchema>) => {
    createContactMutation.mutate(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {contact ? "Kontakt bearbeiten" : "Neuer Kontakt"}
          </DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Max Mustermann" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unternehmen</FormLabel>
                  <FormControl>
                    <Input placeholder="Mustermann Development GmbH" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-Mail</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="max@mustermann.at" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefon</FormLabel>
                  <FormControl>
                    <Input type="tel" placeholder="+43-1-234-5678" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notizen</FormLabel>
                  <FormControl>
                    <Textarea 
                      rows={3} 
                      placeholder="Zusätzliche Informationen..." 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="flex space-x-3 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                className="flex-1" 
                onClick={onClose}
              >
                Abbrechen
              </Button>
              <Button 
                type="submit" 
                className="flex-1"
                disabled={createContactMutation.isPending}
              >
                {contact ? "Aktualisieren" : "Speichern"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
