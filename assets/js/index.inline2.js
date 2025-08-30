const showDayDetailsModal = (date, events) => { 
            const modal = document.getElementById('day-details-modal'); 
            const title = document.getElementById('day-details-title'); 
            const eventsList = document.getElementById('day-events-list'); 
            const formattedDate = date.toLocaleDateString('pt-BR', { 
                day: 'numeric', 
                month: 'long', 
                year: 'numeric' 
            }); 
            title.textContent = `Aplicações de ${formattedDate}`; 
            eventsList.innerHTML = ''; 
            
            events.forEach((event, index) => { 
                const eventItem = document.createElement('div'); 
                eventItem.className = 'bg-gray-50 rounded-lg p-4 border border-gray-200'; 
                const productNames = event.products.map(p => p.name).join(' + '); 
                const targetName = event.plantingName || event.animalGroupName || 'Não especificado'; 
                const notes = event.notes || 'Nenhuma observação'; 
                
                eventItem.innerHTML = `
                    <div class="mb-3">
                        <h3 class="font-semibold text-lg text-gray-800 mb-2">Aplicação ${index + 1}</h3>
                        <div class="space-y-2 text-sm">
                            <div>
                                <span class="font-medium text-gray-700">Título da Aplicação:</span>
                                <span class="text-gray-600 ml-2">${productNames}</span>
                            </div>
                            <div>
                                <span class="font-medium text-gray-700">Alvo:</span>
                                <span class="text-gray-600 ml-2">${targetName}</span>
                            </div>
                            <div>
                                <span class="font-medium text-gray-700">Dose:</span>
                                <span class="text-gray-600 ml-2">${event.dose || 'Não especificada'}</span>
                            </div>
                            <div>
                                <span class="font-medium text-gray-700">Observações:</span>
                                <span class="text-gray-600 ml-2">${notes}</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-2 mt-4">
                        <button onclick="handleEditReminder(${JSON.stringify(event).replace(/"/g, '&quot;')})" 
                                class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm transition-colors flex-1">
                            <i class="fas fa-edit mr-1"></i> Editar
                        </button>
                        <button onclick="markReminderAsCompleted('${event.id}')" 
                                class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm transition-colors flex-1">
                            <i class="fas fa-check mr-1"></i> Marcar como Concluída
                        </button>
                    </div>
                `; 
                eventsList.appendChild(eventItem); 
            }); 
            modal.style.display = 'flex'; 
        }; 
        
        document.addEventListener('DOMContentLoaded', () => { 
            const modal = document.getElementById('day-details-modal'); 
            const closeBtn = document.getElementById('close-day-details-btn'); 
            const closeBottomBtn = document.getElementById('close-day-details-bottom-btn'); 
            
            const closeModal = () => { 
                modal.style.display = 'none'; 
            }; 
            
            closeBtn.addEventListener('click', closeModal); 
            closeBottomBtn.addEventListener('click', closeModal); 
            modal.addEventListener('click', (e) => { 
                if (e.target === modal) { 
                    closeModal(); 
                } 
            }); 
        });