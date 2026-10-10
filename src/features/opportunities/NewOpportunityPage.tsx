import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { t } from '@/i18n/pt-BR';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { UF } from '@/lib/identity';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/form';
import { FieldError, FormAlert, Notice, Section } from '@/components/ui/section';
import type { NegotiationModel } from './types';

const MODELS = Object.keys(t.enums.negotiationModel) as NegotiationModel[];

const schema = z.object({
  city: z.string().trim().min(2, t.newArea.errors.city),
  neighborhood: z.string().trim(),
  state: z.enum(UF),
  area_m2: z.coerce.number<string>().positive(t.newArea.errors.area),
  land_type: z.string().trim(),
  negotiation_models: z.array(z.enum(MODELS as [NegotiationModel, ...NegotiationModel[]])),
  negotiation_conditions: z.string().trim(),
});
type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

/** Corretor aprovado cadastra área "captada"; a curadoria qualifica (RLS + trigger no banco). */
export function NewOpportunityPage() {
  const { session, isApprovedBroker } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: async (v: FormValues) => {
      const { data, error } = await supabase
        .from('opportunities')
        .insert({
          city: v.city,
          neighborhood: v.neighborhood || null,
          state: v.state,
          area_m2: v.area_m2,
          land_type: v.land_type || null,
          negotiation_models: v.negotiation_models,
          negotiation_conditions: v.negotiation_conditions || null,
          responsible_party_user_id: session!.user.id,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ['opportunities-blind'] });
      navigate(`/oportunidades/${id}`);
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      state: 'RS',
      negotiation_models: [],
      neighborhood: '',
      land_type: '',
      negotiation_conditions: '',
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-semibold text-primary">{t.newArea.title}</h1>
      {!isApprovedBroker ? (
        <Notice tone="warning">{t.newArea.needCreci}</Notice>
      ) : (
        <Section title={t.newArea.title} description={t.newArea.body}>
          <form
            onSubmit={handleSubmit((v) => create.mutate(v))}
            className="grid gap-4 sm:grid-cols-3"
            noValidate
          >
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="city">{t.newArea.city}</Label>
              <Input id="city" {...register('city')} />
              <FieldError message={errors.city?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state">{t.newArea.state}</Label>
              <Select id="state" {...register('state')}>
                {UF.map((uf) => (
                  <option key={uf}>{uf}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="neighborhood">{t.newArea.neighborhood}</Label>
              <Input id="neighborhood" {...register('neighborhood')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area_m2">{t.newArea.area}</Label>
              <Input id="area_m2" inputMode="decimal" {...register('area_m2')} />
              <FieldError message={errors.area_m2 && t.newArea.errors.area} />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="land_type">{t.newArea.landType}</Label>
              <Input id="land_type" {...register('land_type')} />
            </div>
            <fieldset className="space-y-2 sm:col-span-3">
              <legend className="text-xs font-medium text-muted">{t.newArea.models}</legend>
              <div className="flex flex-wrap gap-4">
                {MODELS.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      value={m}
                      className="accent-action"
                      {...register('negotiation_models')}
                    />
                    {t.enums.negotiationModel[m]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="negotiation_conditions">{t.newArea.conditions}</Label>
              <Textarea id="negotiation_conditions" {...register('negotiation_conditions')} />
            </div>
            <div className="sm:col-span-3">
              <FormAlert message={create.isError ? t.common.error : null} />
              <Button type="submit" className="mt-2" disabled={create.isPending}>
                {create.isPending ? t.newArea.submitting : t.newArea.submit}
              </Button>
            </div>
          </form>
        </Section>
      )}
    </div>
  );
}
