/*global define*/
define(function (require) {
    'use strict';

    var utils = require('ng-admin/lib/utils'),
        Queries = require('ng-admin/Crud/repository/Queries');

    /**
     * @constructor
     */
    function RetrieveQueries() {
        Queries.apply(this, arguments);
    }

    utils.inherits(RetrieveQueries, Queries);

    /**
     * Get one entity
     *
     * @param {View}   view      the edit view associated to the entity
     * @param {Number} entityId  id of the entity
     *
     * @returns {promise} (list of fields (with their values if set) & the entity name, label & id-
     */
    RetrieveQueries.prototype.getOne = function (view, entityId) {
        var interceptor = view.interceptor(),
            params = this.config.getQueryParamsFor(view, view.getExtraParams()),
            headers = view.getHeaders(),
            routeUrl = this.config.getRouteFor(view, entityId);

        if (interceptor) {
            this.Restangular.addResponseInterceptor(interceptor);
        }

        // Get element data
        return this.Restangular
            .oneUrl(view.name(), routeUrl)
            .get(params, headers)
            .then(function (response) {
                return view.mapEntry(response.data);
            });
    };

    /**
     * Return the list of all object of entityName type
     * Get all the object from the API
     *
     * @param {ListView} view                the view associated to the entity
     * @param {Number}   page                the page number
     * @param {Boolean}  fillSimpleReference should we fill Reference list
     * @param {Object}   searchParams        searchQuery to filter elements
     * @param {String}   sortField           the field to be sorted ex: entity.fieldName
     * @param {String}   sortDir             the direction of the sort
     * @param {Object}   filters             filter specific fields
     *
     * @returns {promise} the entity config & the list of objects
     */
    RetrieveQueries.prototype.getAll = function (view, page, fillSimpleReference, searchParams, sortField, sortDir, filters) {
        var rawEntries,
            entries,
            referencedValues,
            self = this;

        page = page || 1;
        fillSimpleReference = typeof (fillSimpleReference) === 'undefined' ? true : fillSimpleReference;

        return this.getRawValues(view, page, searchParams, sortField, sortDir, filters)
            .then(function (values) {
                rawEntries = values;

                return self.getReferencedValues(view, rawEntries.data);
            }).then(function (refValues) {
                referencedValues = refValues;

                entries = view.mapEntries(rawEntries.data);
                entries = self.fillReferencesValuesFromCollection(entries, referencedValues, fillSimpleReference);
                entries = view.getMappedValue(entries);

                return {
                    view: view,
                    entries: entries,
                    currentPage: page,
                    perPage: view.perPage(),
                    totalItems: view.totalItems()(rawEntries)
                };
            });
    };

    /**
     * Return the list of all object of entityName type
     * Get all the object from the API
     *
     * @param {ListView} listView     the view associated to the entity
     * @param {Number}   page         the page number
     * @param {Object}   searchParams searchQuery to filter elements
     * @param {String}   sortField    the field to be sorted ex: entity.fieldName
     * @param {String}   sortDir      the direction of the sort
     * @param {Object}   filters      filter specific fields
     *
     * @returns {promise} the entity config & the list of objects
     */
    RetrieveQueries.prototype.getRawValues = function (listView, page, searchParams, sortField, sortDir, filters) {
        page = (typeof (page) === 'undefined') ? 1 : parseInt(page, 10);
        filters = (typeof (filters) === 'undefined') ? {} : filters;

        var interceptor = listView.interceptor(),
            sortView = sortField ? sortField.split('.')[0] : '',
            sortParams = sortView === listView.name() ? listView.getSortParams(sortField.split('.').pop(), sortDir) : null,
            params = this.config.getQueryParamsFor(listView, listView.getAllParams(page, sortParams, searchParams)),
            headers = listView.getAllHeaders(sortParams),
            routeUrl = this.config.getRouteFor(listView),
            fieldName;

        filters = listView.filterParams()(filters);

        // Add filters
        for (fieldName in filters) {
            params[fieldName] = filters[fieldName];
        }

        if (interceptor) {
            this.Restangular.addResponseInterceptor(interceptor);
        }

        // Get grid data
        return this.Restangular
            .allUrl(listView.name(), routeUrl)
            .getList(params, headers);
    };

    /**
     * Returns all References for an entity with associated values [{targetEntity.identifier: targetLabel}, ...]
     *
     * @param {View}  view
     * @param {Array} rawValues
     *
     * @returns {promise}
     */
    RetrieveQueries.prototype.getReferencedValues = function (view, rawValues) {
        var self = this,
            references = view.getReferences(),
            calls = [],
            singleCallFilters,
            identifiers,
            reference,
            referencedView,
            entries,
            i,
            j,
            k;

        for (i in references) {
            reference = references[i];
            referencedView = reference.getReferencedView();
            singleCallFilters = reference.getSingleApiCall(identifiers);

            // Check if we should retrieve values with 1 or multiple requests
            if (singleCallFilters || !rawValues) {
                calls.push(self.getRawValues(referencedView, 1, false, reference.getSortFieldName(), 'ASC', singleCallFilters));
            } else {
                identifiers = reference.getIdentifierValues(rawValues);

                for (k in identifiers) {
                    calls.push(self.getOne(referencedView, identifiers[k]));
                }
            }
        }

        // Fill all reference entries
        return this.$q.all(calls)
            .then(function (responses) {
                i = 0;

                for (j in references) {
                    reference = references[j];
                    singleCallFilters = reference.getSingleApiCall(identifiers);

                    // Retrieve entries depending on 1 or many request was done
                    if (singleCallFilters || !rawValues) {
                        references[j].setEntries(reference.getReferencedView().mapEntries(responses[i++].data));
                    } else {
                        entries = [];
                        identifiers = reference.getIdentifierValues(rawValues);
                        for (k in identifiers) {
                            entries.push(responses[i++]);
                        }

                        // Entry are already mapped by getOne
                        references[j].setEntries(entries);
                    }
                }

                return references;
            });
    };

    /**
     * Returns all ReferencedList for an entity for associated values [{targetEntity.identifier: [targetFields, ...]}}
     *
     * @param {View}   view
     * @param {String} sortField
     * @param {String} sortDir
     * @param {*} entityId
     *
     * @returns {promise}
     */
    RetrieveQueries.prototype.getReferencedListValues = function (view, sortField, sortDir, entityId) {
        var self = this,
            referenceLists = view.getReferencedLists(),
            calls = [],
            referenceList,
            referencedView,
            filter,
            i,
            j;

        for (i in referenceLists) {
            referenceList = referenceLists[i];
            filter = {};
            filter[referenceList.targetReferenceField()] = entityId;

            calls.push(self.getRawValues(referenceList.getReferencedView(), 1, null, sortField, sortDir, filter));
        }

        return this.$q.all(calls)
            .then(function (responses) {
                j = 0;

                for (i in referenceLists) {
                    referenceList = referenceLists[i];
                    referencedView = referenceList.getReferencedView();

                    // Map entries
                    referenceList.setEntries(referencedView.mapEntries(responses[j++].data));
                }

                return referenceLists;
            });
    };

    /**
     * Fill ReferencedMany & Reference values from a collection a values
     *
     * @param {[Entry]}  collection
     * @param {Object}  referencedValues
     * @param {Boolean} fillSimpleReference
     * @returns {Array}
     */
    RetrieveQueries.prototype.fillReferencesValuesFromCollection = function (collection, referencedValues, fillSimpleReference) {
        fillSimpleReference = typeof (fillSimpleReference) === 'undefined' ? false : fillSimpleReference;

        var i, l;

        for (i = 0, l = collection.length; i < l; i++) {
            collection[i] = this.fillReferencesValuesFromEntry(collection[i], referencedValues, fillSimpleReference);
        }

        return collection;
    };

    /**
     * Fill ReferencedMany & Reference values from a collection a values
     *
     * @param {Entry}  entry
     * @param {Object}  referencedValues
     * @param {Boolean} fillSimpleReference
     * @returns {Array}
     */
    RetrieveQueries.prototype.fillReferencesValuesFromEntry = function (entry, referencedValues, fillSimpleReference) {
        var reference,
            referenceField,
            choices,
            entries,
            identifier,
            id,
            i;

        for (referenceField in referencedValues) {
            reference = referencedValues[referenceField];
            choices = reference.getChoicesById();
            entries = [];
            identifier = reference.getMappedValue(entry.values[referenceField], entry.values);

            if (reference.type() === 'ReferenceMany') {
                for (i in identifier) {
                    id = identifier[i];
                    entries.push(choices[id]);
                }

                entry.listValues[referenceField] = entries;
            } else if (fillSimpleReference && identifier && identifier in choices) {
                entry.listValues[referenceField] = reference.getMappedValue(choices[identifier], entry.values);
            }
        }

        return entry;
    };

    RetrieveQueries.$inject = ['$q', 'Restangular', 'NgAdminConfiguration'];

    return RetrieveQueries;
});
