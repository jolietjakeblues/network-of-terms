import {
  filterLiteralsByLanguage,
  literalValues,
  Catalog,
  Dataset,
  Distribution,
  DistributionsService,
  Error,
  Feature,
  FeatureType,
  LookupQueryResult,
  LookupResult,
  LookupService,
  NotFoundError,
  QueryMode,
  QueryTermsService,
  ServerError,
  SourceNotFoundError,
  SourceResult,
  Term,
  TermsResponse,
  TermsResult,
  TimeoutError,
} from '@netwerk-digitaal-erfgoed/network-of-terms-query';
import * as RDF from '@rdfjs/types';
import {dereferenceGenre} from '@netwerk-digitaal-erfgoed/network-of-terms-catalog';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listSources(object: any, args: any, context: any): Promise<any> {
  return context.catalog
    .getDatasetsSortedByName(context.catalogLanguage)
    .flatMap((dataset: Dataset) =>
      dataset.distributions.map(distribution =>
        source(distribution, dataset, context.catalogLanguage)
      )
    );
}

async function queryTerms(
  _: unknown,
  args: {
    sources: string[];
    query: string;
    queryMode: string;
    limit: number;
    timeoutMs: number;
    languages: string[];
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any
): Promise<unknown> {
  const service = new DistributionsService({
    logger: context.app.log,
    catalog: context.catalog,
    comunica: context.comunica,
  });
  const results = await service.queryAll({
    sources: args.sources,
    query: args.query,
    queryMode: QueryMode[args.queryMode as keyof typeof QueryMode],
    limit: args.limit,
    timeoutMs: args.timeoutMs,
  });
  return resolveTermsResponse(
    results,
    context.catalog,
    [...(args.languages ?? []), context.catalogLanguage][0],
    args.languages
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lookupTerms(object: any, args: any, context: any) {
  const service = new LookupService(
    context.catalog,
    new QueryTermsService({comunica: context.comunica, logger: context.app.log})
  );
  const results = await service.lookup(args.uris, args.timeoutMs);

  return results.map((result: LookupQueryResult) => {
    return {
      uri: result.uri,
      source:
        result.distribution instanceof SourceNotFoundError
          ? result.distribution
          : source(
              result.distribution,
              context.catalog.getDatasetByDistributionIri(
                result.distribution.iri
              )!,
              context.catalogLanguage
            ),
      result:
        result.result instanceof Term
          ? args.languages === undefined
            ? mapToTerm(result.result, ['nl'])
            : mapToTranslatedTerm(result.result, args.languages)
          : result.result,
      responseTimeMs: result.responseTimeMs,
    };
  });
}

function resolveTermsResponse(
  results: TermsResponse[],
  catalog: Catalog,
  catalogLanguage: string,
  resultLanguages: string[]
) {
  return results.map((response: TermsResponse) => {
    if (response.result instanceof Error) {
      return {
        source: source(
          response.result.distribution,
          catalog.getDatasetByDistributionIri(
            response.result.distribution.iri
          )!,
          catalogLanguage
        ),
        result: response.result,
        responseTimeMs: response.responseTimeMs,
        terms: [], // For BC.
      };
    }

    const terms = response.result.terms.map(term =>
      mapToTerm(term, resultLanguages)
    );

    return {
      source: source(
        response.result.distribution,
        catalog.getDatasetByDistributionIri(response.result.distribution.iri)!,
        catalogLanguage
      ),
      result:
        resultLanguages === undefined
          ? {terms}
          : new TranslatedTerms(
              response.result.terms.map(term =>
                mapToTranslatedTerm(term, resultLanguages)
              )
            ),
      responseTimeMs: response.responseTimeMs,
      terms, // For BC.
    };
  });
}

class TranslatedTerms {
  constructor(readonly terms: object[]) {}
}

function mapToTranslatedTerm(term: Term, languages: string[]) {
  return {
    type: 'TranslatedTerm',
    uri: term.id!.value,
    prefLabel: filterLiteralsByLanguage(term.prefLabels, languages),
    altLabel: filterLiteralsByLanguage(term.altLabels, languages),
    hiddenLabel: filterLiteralsByLanguage(term.hiddenLabels, languages),
    definition: filterLiteralsByLanguage(term.scopeNotes, languages),
    scopeNote: filterLiteralsByLanguage(term.scopeNotes, languages),
    seeAlso: term.seeAlso.map((seeAlso: RDF.NamedNode) => seeAlso.value),
    broader: term.broaderTerms.map(related => ({
      uri: related.id.value,
      prefLabel: filterLiteralsByLanguage(related.prefLabels, languages),
    })),
    narrower: term.narrowerTerms.map(related => ({
      uri: related.id.value,
      prefLabel: filterLiteralsByLanguage(related.prefLabels, languages),
    })),
    related: term.relatedTerms.map(related => ({
      uri: related.id.value,
      prefLabel: filterLiteralsByLanguage(related.prefLabels, languages),
    })),
    exactMatch: term.exactMatches.map(exactMatch => ({
      uri: exactMatch.id.value,
      prefLabel: filterLiteralsByLanguage(exactMatch.prefLabels, languages),
    })),
  };
}

function mapToTerm(term: Term, languages: string[]) {
  return {
    uri: term.id!.value,
    prefLabel: literalValues(term.prefLabels, languages),
    altLabel: literalValues(term.altLabels, languages),
    hiddenLabel: literalValues(term.hiddenLabels, languages),
    definition: literalValues(term.scopeNotes, languages),
    scopeNote: literalValues(term.scopeNotes, languages),
    seeAlso: term.seeAlso.map((seeAlso: RDF.NamedNode) => seeAlso.value),
    broader: term.broaderTerms.map(related => ({
      uri: related.id.value,
      prefLabel: literalValues(related.prefLabels, languages),
    })),
    narrower: term.narrowerTerms.map(related => ({
      uri: related.id.value,
      prefLabel: literalValues(related.prefLabels, languages),
    })),
    related: term.relatedTerms.map(related => ({
      uri: related.id.value,
      prefLabel: literalValues(related.prefLabels, languages),
    })),
    exactMatch: term.exactMatches.map(exactMatch => ({
      uri: exactMatch.id.value,
      prefLabel: literalValues(exactMatch.prefLabels, languages),
    })),
  };
}

async function source(
  distribution: Distribution,
  dataset: Dataset,
  catalogLanguage: string
) {
  return {
    uri: dataset.iri,
    name: dataset.name[catalogLanguage],
    alternateName: dataset.alternateName?.[catalogLanguage],
    description: dataset.description[catalogLanguage],
    mainEntityOfPage: [dataset.mainEntityOfPage],
    inLanguage: dataset.inLanguage,
    creators: dataset.creators.map(creator => ({
      uri: creator.iri,
      name: creator.name[catalogLanguage] ?? Object.values(creator.name)[0],
      alternateName:
        creator.alternateName[catalogLanguage] ?? creator.alternateName[''],
    })),
    genres: dataset.genres.map(async genre => ({
      uri: genre.toString(),
      name: (await dereferenceGenre(genre))?.name[catalogLanguage] ?? 'Unknown',
    })),
    features: distribution.features.map((feature: Feature) => ({
      type: Object.entries(FeatureType).find(
        ([_, val]) => val === feature.type
      )?.[0],
      url: feature.url.toString(),
    })),
  };
}

export const resolvers = {
  Query: {
    sources: listSources,
    terms: queryTerms,
    lookup: lookupTerms,
  },
  TermsResult: {
    resolveType(result: TermsResult) {
      if (result instanceof TimeoutError) {
        return 'TimeoutError';
      }

      if (result instanceof ServerError) {
        return 'ServerError';
      }

      if (result instanceof TranslatedTerms) {
        return 'TranslatedTerms';
      }

      return 'Terms';
    },
  },
  SourceResult: {
    resolveType(result: SourceResult) {
      if (result instanceof SourceNotFoundError) {
        return 'SourceNotFoundError';
      }

      return 'Source';
    },
  },
  LookupResult: {
    resolveType(result: LookupResult | {type: 'TranslatedTerm'}) {
      if (result instanceof NotFoundError) {
        return 'NotFoundError';
      }

      if (result instanceof TimeoutError) {
        return 'TimeoutError';
      }

      if (result instanceof ServerError) {
        return 'ServerError';
      }

      if (result.type === 'TranslatedTerm') {
        return 'TranslatedTerm';
      }

      return 'Term';
    },
  },
};
