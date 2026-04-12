package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func NewRouter() http.Handler {
	r := chi.NewRouter()

	r.Get("/health", healthHandler)
	r.Post("/orders", createOrderHandler)
	r.Get("/orders/{id}", getOrderHandler)
	r.Put("/orders/{id}", updateOrderHandler)
	r.Delete("/orders/{id}", deleteOrderHandler)

	return r
}

func healthHandler(w http.ResponseWriter, r *http.Request)      {}
func createOrderHandler(w http.ResponseWriter, r *http.Request) {}
func getOrderHandler(w http.ResponseWriter, r *http.Request)    {}
func updateOrderHandler(w http.ResponseWriter, r *http.Request) {}
func deleteOrderHandler(w http.ResponseWriter, r *http.Request) {}
